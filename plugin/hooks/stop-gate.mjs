#!/usr/bin/env node
/**
 * Antigravity `Stop` hook -> Scoped Skill Delivery & Artifact Contract Gate (v0.2.0).
 *
 * Guarantees:
 *   1. Scoped strictly to THIS plugin's role skills (`<slug>-planner`, `<slug>-producer`, `<slug>-verifier`, etc.).
 *      Unrelated conversations and other Swarm plugins exit immediately with `{}`.
 *   2. Multi-turn safe: detects the worker's loaded `SKILL.md` across full session history (so Turn 2+ revise
 *      loops remain protected even when the worker does not re-read `SKILL.md`), while evaluating ONLY the
 *      current turn's outputs after the latest user input or `swarm_wait` wakeup.
 *   3. Inspects BOTH `PLANNER_RESPONSE` text AND `post_message` board arguments.
 *   4. Anti-hallucination filesystem checks: when `payload.cwd` is provided, verifies that required artifacts
 *      (`.<slug>/ownership.json`, `work/plan/`, `work/drafts|deliverables/`, `work/reviews/`) actually exist on disk.
 *   5. Blocks AT MOST ONCE per turn (`continuationActive` check + per-wakeup turn key).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ownershipFilePath, pluginSlug, sanitizeId, stateRoot } from './lib-swarm-scope.mjs';

function hasNonEmptyFileIn(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return false;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (hasNonEmptyFileIn(full)) return true;
      } else if (entry.isFile() && fs.statSync(full).size > 0) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Delivery contract checks keyed by role suffix (`<plugin-slug>-<suffix>`).
 * Each `check(text, ctx)` may return either a boolean or `{ ok: boolean, detail?: string }`.
 */
export const ROLE_CONTRACTS = {
  planner: {
    check: (text, ctx) => {
      const m = /PLAN_STATUS:\s*(READY|NEEDS_INPUT)/i.exec(text);
      if (!m) {
        return { ok: false, detail: 'missing "PLAN_STATUS: READY" (or NEEDS_INPUT)' };
      }
      if (m[1].toUpperCase() === 'NEEDS_INPUT') return { ok: true };
      if (!/ownership\.json/i.test(text)) {
        return { ok: false, detail: 'missing confirmation of ownership.json manifest path' };
      }
      if (ctx.hasExplicitCwd) {
        const ownPath = ownershipFilePath(ctx.cwd);
        if (!fs.existsSync(ownPath)) {
          return {
            ok: false,
            detail: `claimed PLAN_STATUS: READY, but "${ownPath}" was not found on disk — write it via write_file before finishing`,
          };
        }
        if (!hasNonEmptyFileIn(path.join(ctx.cwd, 'work', 'plan'))) {
          return {
            ok: false,
            detail: 'claimed PLAN_STATUS: READY, but no non-empty spec file exists under "work/plan/" on disk',
          };
        }
      }
      return { ok: true };
    },
    missingReason: (skillName, detail) =>
      `DELIVERY_CONTRACT_UNMET (${skillName}): ${detail || 'Before finishing, include explicit "PLAN_STATUS: READY" (or NEEDS_INPUT) and write both work/plan/spec.md and ownership.json to disk.'}`,
  },
  producer: {
    check: (text, ctx) => {
      const m = /DELIVERABLE_STATUS:\s*(READY_FOR_AUDIT|REVISED|BLOCKED)/i.exec(text);
      if (!m) {
        return {
          ok: false,
          detail: 'missing "DELIVERABLE_STATUS: READY_FOR_AUDIT" (or REVISED/BLOCKED), output file paths, and self-check summary',
        };
      }
      if (m[1].toUpperCase() === 'BLOCKED') return { ok: true };
      if (ctx.hasExplicitCwd) {
        const hasOutput =
          hasNonEmptyFileIn(path.join(ctx.cwd, 'work', 'drafts')) ||
          hasNonEmptyFileIn(path.join(ctx.cwd, 'work', 'deliverables'));
        if (!hasOutput) {
          return {
            ok: false,
            detail: 'claimed deliverable is ready, but no non-empty file exists under "work/drafts/" or "work/deliverables/" on disk',
          };
        }
      }
      return { ok: true };
    },
    missingReason: (skillName, detail) =>
      `DELIVERY_CONTRACT_UNMET (${skillName}): ${detail || 'Before finishing, write your deliverable file and include "DELIVERABLE_STATUS: READY_FOR_AUDIT" (or REVISED/BLOCKED).'}`,
  },
  verifier: {
    check: (text, ctx) => {
      if (!/VERDICT:\s*(PASS|REVISE)/i.test(text)) {
        return {
          ok: false,
          detail: 'missing explicit "VERDICT: PASS" or "VERDICT: REVISE" (or 3-Strike "[escalate]" to @coordinator)',
        };
      }
      if (ctx.hasExplicitCwd) {
        if (!hasNonEmptyFileIn(path.join(ctx.cwd, 'work', 'reviews'))) {
          return {
            ok: false,
            detail: 'declared VERDICT in text, but no non-empty audit report file exists under "work/reviews/" on disk',
          };
        }
      }
      return { ok: true };
    },
    missingReason: (skillName, detail) =>
      `DELIVERY_CONTRACT_UNMET (${skillName}): ${detail || 'Before finishing, write your structured report under work/reviews/ and include "VERDICT: PASS" or "VERDICT: REVISE".'}`,
  },
};

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function evaluateStopContract(payload) {
  if (
    payload?.continuationActive === true ||
    payload?.terminationReason !== 'NO_TOOL_CALL' ||
    payload?.fullyIdle === false
  ) {
    return {};
  }

  const transcriptPath = payload?.transcriptPath;
  const convId = payload?.conversationId || 'unknown';
  if (typeof transcriptPath !== 'string' || !fs.existsSync(transcriptPath)) {
    return {};
  }

  const rawLines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n').filter(Boolean);
  const steps = [];
  for (const line of rawLines) {
    try {
      steps.push(JSON.parse(line));
    } catch {
      /* skip malformed line */
    }
  }
  if (steps.length === 0) return {};

  const slug = pluginSlug();
  const skillPathRe = new RegExp(`[/\\\\]skills[/\\\\](${escapeRegExp(slug)}-([a-z0-9-]+))[/\\\\]SKILL\\.md$`, 'i');

  // 1. Scan full session history for THIS plugin's role skill + find latest wakeup boundary
  let loadedSkill = null;
  let loadedRoleSuffix = null;
  let lastWakeIdx = -1;

  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (st.type === 'USER_INPUT' || st.type === 'SYSTEM_MESSAGE' || st.type === 'WAKEUP') {
      lastWakeIdx = i;
    }
    if (Array.isArray(st.tool_calls)) {
      for (const tc of st.tool_calls) {
        const tName = tc?.name || '';
        // An earlier completed `swarm_wait` marks the end of the previous Swarm turn
        if (tName === 'swarm_wait' && i < steps.length - 1) {
          lastWakeIdx = Math.max(lastWakeIdx, i);
        }
        const p = tc?.args?.Path || tc?.arguments?.Path || '';
        if (typeof p === 'string') {
          const m = skillPathRe.exec(p);
          if (m) {
            loadedSkill = m[1].toLowerCase();
            loadedRoleSuffix = m[2].toLowerCase();
          }
        }
      }
    }
  }

  if (!loadedSkill || !loadedRoleSuffix || !Object.hasOwn(ROLE_CONTRACTS, loadedRoleSuffix)) {
    return {};
  }

  // 2. Inspect ONLY the current turn's steps (after `lastWakeIdx`)
  const turnSteps = lastWakeIdx >= 0 ? steps.slice(lastWakeIdx + 1) : steps;
  let lastPlannerText = '';
  let lastBoardText = '';
  const allTexts = [];

  for (const st of turnSteps) {
    if (typeof st.content === 'string' && st.content) {
      allTexts.push(st.content);
      if (st.type === 'PLANNER_RESPONSE') lastPlannerText = st.content;
    }
    if (Array.isArray(st.tool_calls)) {
      for (const tc of st.tool_calls) {
        const tName = tc?.name || '';
        if (tName === 'ask_question' || tName === 'swarm_wait') {
          return {};
        }
        if (tName === 'post_message') {
          const boardMsg = tc?.args?.text || tc?.args?.message || tc?.arguments?.text || tc?.arguments?.message || '';
          if (typeof boardMsg === 'string' && boardMsg) {
            allTexts.push(boardMsg);
            lastBoardText = boardMsg;
          }
        }
      }
    }
  }

  const combined = allTexts.join('\n');
  const trimmedLast = (lastPlannerText || lastBoardText).trim();
  if (
    !trimmedLast ||
    lastPlannerText.trim().endsWith('?') ||
    lastPlannerText.trim().endsWith('？') ||
    /NEEDS_INPUT|STATUS:\s*BLOCKED|\[escalate\]/i.test(combined)
  ) {
    return {};
  }

  const gateDir = path.join(stateRoot(), 'stop-gate');
  fs.mkdirSync(gateDir, { recursive: true });
  const recordFile = path.join(gateDir, `${sanitizeId(convId)}.json`);
  let rec = {};
  try {
    rec = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  } catch {
    rec = {};
  }

  const turnKey = `${lastWakeIdx}:${loadedSkill}`;
  if (rec[turnKey]) {
    return {};
  }

  const ctx = {
    cwd: payload?.cwd ? path.resolve(payload.cwd) : process.cwd(),
    hasExplicitCwd: typeof payload?.cwd === 'string' && payload.cwd.trim().length > 0,
    slug,
  };

  const contract = ROLE_CONTRACTS[loadedRoleSuffix];
  const rawEval = contract.check(combined, ctx);
  const normalized = typeof rawEval === 'boolean' ? { ok: rawEval } : rawEval;

  if (normalized?.ok) {
    rec[turnKey] = 'met';
    fs.writeFileSync(recordFile, JSON.stringify(rec, null, 2));
    return {};
  }

  rec[turnKey] = 'blocked_once';
  fs.writeFileSync(recordFile, JSON.stringify(rec, null, 2));
  return {
    decision: 'continue',
    reason: `${contract.missingReason(loadedSkill, normalized?.detail)} (This gate blocks at most once per turn.)`,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(raw || '{}');
      const result = evaluateStopContract(payload);
      process.stdout.write(JSON.stringify(result) + '\n');
    } catch {
      process.stdout.write('{}\n');
    }
  });
}
