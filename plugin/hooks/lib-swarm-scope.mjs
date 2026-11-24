/**
 * Coexistence-safe Swarm Scope, Role Detection & File-Ownership Engine for Antigravity Plugins.
 *
 * Key architectural guarantees (zero external dependencies, Node.js >= 20):
 *   1. Uses Antigravity's injected `PLUGIN_ROOT` and `PLUGIN_DATA` environment variables.
 *   2. Fast-path isolation: returns `{ allowed: true, skipped: true }` in ~1ms for any
 *      conversation or workspace not belonging to THIS plugin (never blocks other Swarms!).
 *   3. Automatic `@role` extraction from Antigravity's `transcriptPath` with native shard
 *      normalization (`producer-1` -> falls back to `producer` in ownership.json).
 *   4. Supports session-scoped freeze, explicit conversation locks, declarative project
 *      `.<plugin-slug>/ownership.json`, and domain-customizable Zero-Trust role invariants.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Built-in Zero-Trust role invariants (ONLY enforced when THIS swarm plugin is active).
 * Customize these patterns when adapting this template to your own domain!
 */
export const BUILT_IN_INVARIANTS = [
  {
    name: 'verifier-no-deliverable-edits',
    matchRole: (role, baseRole) =>
      role === 'auditor' ||
      baseRole === 'auditor' ||
      role.endsWith('-auditor') ||
      role.endsWith('-verifier') ||
      baseRole.endsWith('-auditor') ||
      baseRole.endsWith('-verifier'),
    denyGlobs: ['work/drafts/**', 'work/deliverables/**'],
    message: (role, filePath) =>
      `Zero-Trust Verifier Guard: "@${role}" is an independent verifier and cannot edit "${filePath}". Report defects on the swarm board and @mention the owning producer.`,
  },
  {
    name: 'planner-no-deliverable-edits',
    matchRole: (role, baseRole) =>
      role === 'lead-planner' ||
      baseRole === 'lead-planner' ||
      role.endsWith('-planner') ||
      baseRole.endsWith('-planner'),
    denyGlobs: ['work/deliverables/**'],
    message: (role, filePath) =>
      `Zero-Trust Planner Guard: "@${role}" owns planning specs only and cannot edit final deliverable "${filePath}". Hand off to @producer on the swarm board.`,
  },
];

let cachedPluginSlug = null;

export function pluginRoot() {
  return process.env.PLUGIN_ROOT || path.resolve(import.meta.dirname, '..');
}

export function pluginSlug() {
  if (process.env.SWARM_PLUGIN_SLUG) return process.env.SWARM_PLUGIN_SLUG.trim();
  if (cachedPluginSlug) return cachedPluginSlug;
  try {
    const manifestPath = path.join(pluginRoot(), 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (typeof manifest?.name === 'string' && manifest.name.trim()) {
      cachedPluginSlug = manifest.name.trim();
      return cachedPluginSlug;
    }
  } catch {
    /* fallback below */
  }
  cachedPluginSlug = path.basename(pluginRoot()) || 'viral-media-swarm';
  return cachedPluginSlug;
}

export function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

/**
 * Persistent state directory isolated strictly to THIS plugin.
 * Prefers Antigravity's `PLUGIN_DATA`, falling back to `~/.antigravity-swarms/<slug>`.
 */
export function stateRoot() {
  if (process.env.SWARM_STATE_ROOT) return process.env.SWARM_STATE_ROOT;
  if (process.env.PLUGIN_DATA) return process.env.PLUGIN_DATA;
  return path.join(homeDir(), '.antigravity-swarms', pluginSlug());
}

export function locksDir() {
  const d = path.join(stateRoot(), 'locks');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function freezeSessionsDir() {
  const d = path.join(stateRoot(), 'freeze-sessions');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function ownershipFilePath(cwd) {
  return path.join(cwd, `.${pluginSlug()}`, 'ownership.json');
}

export function sanitizeId(id) {
  return String(id || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function normalizePosix(p, baseDir = process.cwd()) {
  const resolved = path.resolve(baseDir, p).replace(/\\/g, '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function globToRegExp(globPattern, baseDir) {
  let g = String(globPattern || '').trim().replace(/\\/g, '/');
  if (!path.isAbsolute(g) && !/^[a-zA-Z]:\//.test(g)) {
    g = normalizePosix(path.join(baseDir, g));
  } else {
    g = normalizePosix(g);
  }
  if (g.endsWith('/')) g += '**';
  const escaped = g
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/___GLOBSTAR___/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function readTranscriptHead(transcriptPath, maxBytes = 24576) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(maxBytes);
    const bytes = fs.readSync(fd, buf, 0, maxBytes, 0);
    fs.closeSync(fd);
    return buf.subarray(0, bytes).toString('utf8');
  } catch {
    return '';
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks whether a transcript explicitly belongs to THIS swarm plugin
 * (via `[swarm:<slug>]` brief marker or loading `skills/<slug>` / `skills/<slug>-*`).
 */
export function transcriptMatchesThisPlugin(head, slug = pluginSlug()) {
  if (!head) return false;
  const escaped = escapeRegExp(slug);
  const markerRe = new RegExp(`\\[swarm:${escaped}\\]`, 'i');
  if (markerRe.test(head)) return true;
  const skillRe = new RegExp(`[/\\\\]skills[/\\\\]${escaped}(?:-[a-z0-9-]+)?[/\\\\]SKILL\\.md`, 'i');
  return skillRe.test(head);
}

/**
 * Checks whether a transcript belongs to the Swarm Coordinator rather than a spawned worker.
 * Coordinators either start from a `/swarm` user command, receive `# You are the swarm coordinator`,
 * or load the top-level orchestrator skill `skills/<slug>/SKILL.md` (no `-role` suffix).
 */
export function isCoordinatorTranscript(head, slug = pluginSlug()) {
  if (!head) return false;
  const escaped = escapeRegExp(slug);
  const orchSkillRe = new RegExp(`[/\\\\]skills[/\\\\]${escaped}[/\\\\]SKILL\\.md`, 'i');
  if (orchSkillRe.test(head)) return true;
  if (/# You are the swarm coordinator|[/\\\\]native_swarm[/\\\\]SKILL\.md/i.test(head)) return true;
  return false;
}

function extractFirstInputContent(head) {
  const lines = head.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj?.type === 'USER_INPUT' && typeof obj.content === 'string') {
          return obj.content;
        }
        if (typeof obj?.content === 'string' && obj.content.trim()) {
          return obj.content;
        }
      } catch {
        /* partial trailing line or non-JSON */
      }
    } else {
      return head;
    }
  }
  return '';
}

/**
 * Extracts Antigravity `/swarm` worker roster name strictly from the worker's initial message
 * in `transcript.jsonl`, while guaranteeing the Swarm Coordinator is NEVER misclassified as a worker.
 */
export function detectSwarmWorkerRole(conversationId, transcriptPath, preloadedHead = null) {
  if (!conversationId || !transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const head = preloadedHead ?? readTranscriptHead(transcriptPath);
  if (!head) return null;

  const slug = pluginSlug();
  const cacheFile = path.join(locksDir(), '.role-cache.json');
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    cache = {};
  }

  // Coordinator safeguard always wins (even if an earlier partial step preceded reading SKILL.md)
  if (isCoordinatorTranscript(head, slug)) {
    if (cache[conversationId] !== null) {
      cache[conversationId] = null;
      try {
        fs.writeFileSync(cacheFile, JSON.stringify(cache));
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  if (Object.hasOwn(cache, conversationId)) return cache[conversationId];

  const firstContent = extractFirstInputContent(head);
  if (/^\s*(?:<[^>]+>\s*)*\/swarm\b/i.test(firstContent)) {
    cache[conversationId] = null;
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    } catch {
      /* ignore */
    }
    return null;
  }

  let detected = null;
  const m = /(?:^|\n)\s*(?:<[^>]+>\s*)*@([a-z0-9][a-z0-9_-]{1,23})\b/i.exec(firstContent);
  if (m) {
    const candidate = m[1].toLowerCase();
    if (!['coordinator', 'all', 'narrator', 'monitor'].includes(candidate)) {
      const looksLikeSwarm =
        transcriptMatchesThisPlugin(head, slug) ||
        /swarm_worker|read_board|post_message|【任务目标】|【必读技能】|You own /i.test(head);
      if (looksLikeSwarm) {
        detected = candidate;
      }
    }
  }

  if (detected !== null || head.length >= 4096) {
    cache[conversationId] = detected;
    try {
      const keys = Object.keys(cache);
      if (keys.length > 200) delete cache[keys[0]];
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    } catch {
      /* non-fatal cache write */
    }
  }
  return detected;
}

export function baseShardRole(role) {
  if (!role) return '';
  return role.replace(/-\d+$/, '');
}

function applyRule(rule, workerLabel, normFile, rawPath, baseDir, slug) {
  const ruleBase = rule.cwd || baseDir;
  const denies = Array.isArray(rule.deny) ? rule.deny : [];
  for (const d of denies) {
    if (globToRegExp(d, ruleBase).test(normFile)) {
      return {
        allowed: false,
        reason: `[${slug}-lock] Blocked: "@${workerLabel}" is forbidden from editing "${rawPath}" (matches deny "${d}"). Coordinate on the swarm board with the owning worker or @coordinator.`,
      };
    }
  }
  const allows = Array.isArray(rule.allow) ? rule.allow : [];
  if (allows.length > 0) {
    const matched = allows.some((a) => globToRegExp(a, ruleBase).test(normFile));
    if (!matched) {
      return {
        allowed: false,
        reason: `[${slug}-lock] Blocked: "${rawPath}" is outside "@${workerLabel}"'s allowed paths [${allows.join(', ')}]. Coordinate via @coordinator on the swarm board.`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Evaluates whether a `write_file` / `edit_file` target is allowed under THIS plugin's rules.
 * Strictly fast-path allows unrelated conversations so multiple Swarm plugins coexist safely.
 */
export function checkSwarmOwnership({ conversationId, transcriptPath, filePath, cwd }) {
  if (!filePath) return { allowed: true, skipped: true };
  const slug = pluginSlug();
  const baseDir = cwd || process.cwd();
  const normFile = normalizePosix(filePath, baseDir);

  // Always allow Antigravity brain/artifact writes and this plugin's own state files
  const brainDir = normalizePosix(path.join(homeDir(), '.gemini', 'antigravity', 'brain'));
  const ownStateDir = normalizePosix(stateRoot());
  if (normFile.startsWith(brainDir + '/') || normFile.startsWith(ownStateDir + '/')) {
    return { allowed: true };
  }

  // 1. Session-scoped freeze (`<stateRoot>/freeze-sessions/<conversationId>.txt`)
  if (conversationId) {
    const sessFreeze = path.join(stateRoot(), 'freeze-sessions', `${sanitizeId(conversationId)}.txt`);
    if (fs.existsSync(sessFreeze)) {
      const frozenDir = normalizePosix(fs.readFileSync(sessFreeze, 'utf8').trim(), baseDir).replace(/\/+$/, '');
      if (frozenDir && normFile !== frozenDir && !normFile.startsWith(frozenDir + '/')) {
        return {
          allowed: false,
          reason: `[${slug} session-freeze] Blocked: "${filePath}" is outside this session's frozen directory "${frozenDir}".`,
        };
      }
    }
  }

  // 2. Explicit per-conversation lock (`<stateRoot>/locks/<conversationId>.json`)
  if (conversationId) {
    const lockFile = path.join(stateRoot(), 'locks', `${sanitizeId(conversationId)}.json`);
    if (fs.existsSync(lockFile)) {
      let rule;
      try {
        rule = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      } catch {
        return {
          allowed: false,
          reason: `[${slug}-lock] Corrupt lock file ${lockFile} (fail closed).`,
        };
      }
      return applyRule(rule, rule.worker || conversationId, normFile, filePath, baseDir, slug);
    }
  }

  // 3. Multi-Swarm Coexistence Gate: check if THIS plugin owns this workspace or transcript
  const repoOwnership = ownershipFilePath(baseDir);
  const hasOwnershipFile = fs.existsSync(repoOwnership);
  const head = readTranscriptHead(transcriptPath);
  const inThisTranscript = transcriptMatchesThisPlugin(head, slug);

  if (!hasOwnershipFile && !inThisTranscript) {
    // Fast-path exit: unrelated chat or a different Swarm plugin is running
    return { allowed: true, skipped: true };
  }

  const role = detectSwarmWorkerRole(conversationId, transcriptPath, head);
  if (!role) return { allowed: true };
  const baseRole = baseShardRole(role);

  // 4. Declarative project-level ownership matrix (`.<slug>/ownership.json`)
  if (hasOwnershipFile) {
    let map;
    try {
      map = JSON.parse(fs.readFileSync(repoOwnership, 'utf8'));
    } catch {
      return {
        allowed: false,
        reason: `[${slug}-lock] Corrupt ownership manifest ${repoOwnership} (fail closed).`,
      };
    }
    const roleRule = map[role] || map[`@${role}`] || map[baseRole] || map[`@${baseRole}`];
    if (roleRule) {
      return applyRule(roleRule, role, normFile, filePath, baseDir, slug);
    }
  }

  // 5. Built-in Zero-Trust role invariants (ONLY when explicitly in THIS plugin's swarm)
  if (inThisTranscript || hasOwnershipFile) {
    for (const inv of BUILT_IN_INVARIANTS) {
      if (inv.matchRole(role, baseRole)) {
        const hit = inv.denyGlobs.some((g) => globToRegExp(g, baseDir).test(normFile));
        if (hit) {
          return {
            allowed: false,
            reason: `[${slug}-lock] ${inv.message(role, filePath)}`,
          };
        }
      }
    }
  }

  return { allowed: true };
}
