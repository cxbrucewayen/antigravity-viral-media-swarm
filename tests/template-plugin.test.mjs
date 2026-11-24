import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { checkSwarmOwnership, detectSwarmWorkerRole } from '../plugin/hooks/lib-swarm-scope.mjs';
import { evaluateStopContract } from '../plugin/hooks/stop-gate.mjs';
import { scaffoldSwarm } from '../scripts/scaffold.mjs';
import { validatePlugin } from '../scripts/validate-plugin.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const PLUGIN_DIR = path.join(REPO_ROOT, 'plugin');
const PRE_TOOL_HOOK = path.join(PLUGIN_DIR, 'hooks', 'pre-tool-write.mjs');
const STOP_HOOK = path.join(PLUGIN_DIR, 'hooks', 'stop-gate.mjs');
const LOCK_CLI = path.join(PLUGIN_DIR, 'hooks', 'swarm-lock-cli.mjs');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runNodeHook(scriptPath, stdinObj, envExtra = {}) {
  const r = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(stdinObj),
    encoding: 'utf8',
    env: { ...process.env, ...envExtra },
  });
  assert.equal(r.status, 0, `Hook exited ${r.status}: ${r.stderr}`);
  return JSON.parse((r.stdout || '{}').trim());
}

test('1. Official Antigravity Plugin Spec validation passes with zero errors', () => {
  const res = validatePlugin(PLUGIN_DIR);
  assert.equal(res.ok, true, `Validation errors: ${res.errors.join('; ')}`);
  assert.equal(res.pluginName, 'viral-media-swarm');
  assert.equal(res.warnings.length, 0, `Unexpected warnings: ${res.warnings.join('; ')}`);
});

test('2. Coexistence fast-path: unrelated conversations and other Swarms are NEVER blocked', () => {
  const tmp = makeTmpDir('agy-coexist-');
  const stateDir = path.join(tmp, 'plugin-data');
  const otherTranscript = path.join(tmp, 'other-swarm-transcript.jsonl');
  // Simulate another Swarm plugin (e.g. gstack-swarm) running a worker named @auditor
  fs.writeFileSync(
    otherTranscript,
    JSON.stringify({
      type: 'USER_INPUT',
      content: '@auditor [swarm:other-swarm] You own reviewing files. Read skills/other-swarm-verifier/SKILL.md',
    }) + '\n'
  );

  const out = runNodeHook(
    PRE_TOOL_HOOK,
    {
      conversationId: 'conv-other-1',
      transcriptPath: otherTranscript,
      cwd: tmp,
      toolCall: { name: 'write_file', args: { Path: path.join(tmp, 'work', 'deliverables', 'report.md') } },
    },
    { PLUGIN_ROOT: PLUGIN_DIR, PLUGIN_DATA: stateDir }
  );
  assert.equal(out.decision, 'allow');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('3. Transcript @role detection + sharded worker fallback (`producer-2` -> `producer`)', () => {
  const tmp = makeTmpDir('agy-shard-');
  const stateDir = path.join(tmp, 'plugin-data');
  const prevData = process.env.PLUGIN_DATA;
  process.env.PLUGIN_DATA = stateDir;
  try {
    fs.mkdirSync(path.join(tmp, '.viral-media-swarm'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.viral-media-swarm', 'ownership.json'),
      JSON.stringify({
        producer: { allow: ['work/drafts/**', 'work/deliverables/**'], deny: ['work/reviews/**'] },
        auditor: { allow: ['work/reviews/**'], deny: ['work/drafts/**', 'work/deliverables/**'] },
      })
    );

    const shardTranscript = path.join(tmp, 'producer-2.jsonl');
    fs.writeFileSync(
      shardTranscript,
      JSON.stringify({
        type: 'USER_INPUT',
        content: '@producer-2 [swarm:viral-media-swarm] 【必读技能】viral-media-swarm-producer',
      }) + '\n'
    );

    const role = detectSwarmWorkerRole('conv-shard-2', shardTranscript);
    assert.equal(role, 'producer-2');

    // Allowed write inside producer allow-list
    const okWrite = checkSwarmOwnership({
      conversationId: 'conv-shard-2',
      transcriptPath: shardTranscript,
      filePath: path.join(tmp, 'work', 'drafts', 'slice-2.md'),
      cwd: tmp,
    });
    assert.equal(okWrite.allowed, true);

    // Denied write inside reviews/
    const badWrite = checkSwarmOwnership({
      conversationId: 'conv-shard-2',
      transcriptPath: shardTranscript,
      filePath: path.join(tmp, 'work', 'reviews', 'audit-report.md'),
      cwd: tmp,
    });
    assert.equal(badWrite.allowed, false);
    assert.match(badWrite.reason, /@producer-2/);
  } finally {
    if (prevData === undefined) delete process.env.PLUGIN_DATA;
    else process.env.PLUGIN_DATA = prevData;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('4. Zero-Trust built-in verifier invariant blocks @auditor from editing deliverables even without ownership.json', () => {
  const tmp = makeTmpDir('agy-inv-');
  const stateDir = path.join(tmp, 'plugin-data');
  const auditorTranscript = path.join(tmp, 'auditor.jsonl');
  fs.writeFileSync(
    auditorTranscript,
    JSON.stringify({
      type: 'USER_INPUT',
      content: '@auditor [swarm:viral-media-swarm] 【必读技能】viral-media-swarm-verifier',
    }) + '\n'
  );

  const denied = runNodeHook(
    PRE_TOOL_HOOK,
    {
      conversationId: 'conv-auditor-1',
      transcriptPath: auditorTranscript,
      cwd: tmp,
      toolCall: { name: 'edit_file', args: { Path: path.join(tmp, 'work', 'deliverables', 'final.md') } },
    },
    { PLUGIN_ROOT: PLUGIN_DIR, PLUGIN_DATA: stateDir }
  );
  assert.equal(denied.decision, 'deny');
  assert.match(denied.reason, /Zero-Trust Verifier Guard/);

  const allowed = runNodeHook(
    PRE_TOOL_HOOK,
    {
      conversationId: 'conv-auditor-1',
      transcriptPath: auditorTranscript,
      cwd: tmp,
      toolCall: { name: 'write_file', args: { Path: path.join(tmp, 'work', 'reviews', 'audit-report.md') } },
    },
    { PLUGIN_ROOT: PLUGIN_DIR, PLUGIN_DATA: stateDir }
  );
  assert.equal(allowed.decision, 'allow');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('5. Session-scoped freeze via CLI isolates Session A without blocking parallel Session B', () => {
  const tmp = makeTmpDir('agy-freeze-');
  const stateDir = path.join(tmp, 'plugin-data');
  const env = { ...process.env, PLUGIN_ROOT: PLUGIN_DIR, PLUGIN_DATA: stateDir };
  const dirA = path.join(tmp, 'work', 'slice-a');
  const dirB = path.join(tmp, 'work', 'slice-b');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  const setRes = spawnSync(
    process.execPath,
    [LOCK_CLI, 'freeze-session', '--session', 'sess-A', '--dir', dirA],
    { encoding: 'utf8', env }
  );
  assert.equal(setRes.status, 0, setRes.stderr);

  // Session A blocked outside dirA
  const blockA = runNodeHook(
    PRE_TOOL_HOOK,
    {
      conversationId: 'sess-A',
      cwd: tmp,
      toolCall: { name: 'edit_file', args: { Path: path.join(dirB, 'file.md') } },
    },
    env
  );
  assert.equal(blockA.decision, 'deny');
  assert.match(blockA.reason, /session-freeze/);

  // Session B completely unaffected
  const allowB = runNodeHook(
    PRE_TOOL_HOOK,
    {
      conversationId: 'sess-B',
      cwd: tmp,
      toolCall: { name: 'edit_file', args: { Path: path.join(dirB, 'file.md') } },
    },
    env
  );
  assert.equal(allowB.decision, 'allow');

  // Unfreeze restores Session A
  const clearRes = spawnSync(
    process.execPath,
    [LOCK_CLI, 'unfreeze-session', '--session', 'sess-A'],
    { encoding: 'utf8', env }
  );
  assert.equal(clearRes.status, 0);

  const allowAAfter = runNodeHook(
    PRE_TOOL_HOOK,
    {
      conversationId: 'sess-A',
      cwd: tmp,
      toolCall: { name: 'edit_file', args: { Path: path.join(dirB, 'file.md') } },
    },
    env
  );
  assert.equal(allowAAfter.decision, 'allow');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('6. Stop delivery gate blocks once when verifier omits VERDICT, skips continuationActive & unrelated skills', () => {
  const tmp = makeTmpDir('agy-stop-');
  const stateDir = path.join(tmp, 'plugin-data');
  const env = { PLUGIN_ROOT: PLUGIN_DIR, PLUGIN_DATA: stateDir };

  // 6a. Verifier loaded viral-media-swarm-verifier but forgot VERDICT -> blocks once
  const badTranscript = path.join(tmp, 'bad-verifier.jsonl');
  fs.writeFileSync(
    badTranscript,
    [
      JSON.stringify({ type: 'USER_INPUT', content: '@auditor [swarm:viral-media-swarm] review deliverables' }),
      JSON.stringify({
        type: 'TOOL_CALL',
        tool_calls: [{ name: 'read_file', args: { Path: '/plugins/viral-media-swarm/skills/viral-media-swarm-verifier/SKILL.md' } }],
      }),
      JSON.stringify({ type: 'PLANNER_RESPONSE', content: 'Looks pretty good overall.' }),
    ].join('\n') + '\n'
  );

  const firstTry = runNodeHook(
    STOP_HOOK,
    {
      conversationId: 'conv-stop-1',
      transcriptPath: badTranscript,
      terminationReason: 'NO_TOOL_CALL',
      fullyIdle: true,
      continuationActive: false,
    },
    env
  );
  assert.equal(firstTry.decision, 'continue');
  assert.match(firstTry.reason, /VERDICT: PASS/);

  // 6b. Continuation pass MUST NOT block again
  const secondTry = runNodeHook(
    STOP_HOOK,
    {
      conversationId: 'conv-stop-1',
      transcriptPath: badTranscript,
      terminationReason: 'NO_TOOL_CALL',
      fullyIdle: true,
      continuationActive: true,
    },
    env
  );
  assert.deepEqual(secondTry, {});

  // 6c. Unrelated skill (e.g. gstack-review) is untouched by this plugin's stop gate
  const otherSkillTranscript = path.join(tmp, 'other-skill.jsonl');
  fs.writeFileSync(
    otherSkillTranscript,
    [
      JSON.stringify({ type: 'USER_INPUT', content: 'review diff' }),
      JSON.stringify({
        type: 'TOOL_CALL',
        tool_calls: [{ name: 'read_file', args: { Path: '/plugins/gstack-swarm/skills/gstack-review/SKILL.md' } }],
      }),
      JSON.stringify({ type: 'PLANNER_RESPONSE', content: 'Done.' }),
    ].join('\n') + '\n'
  );

  const prevData = process.env.PLUGIN_DATA;
  process.env.PLUGIN_DATA = stateDir;
  try {
    const ignored = evaluateStopContract({
      conversationId: 'conv-stop-other',
      transcriptPath: otherSkillTranscript,
      terminationReason: 'NO_TOOL_CALL',
      fullyIdle: true,
      continuationActive: false,
    });
    assert.deepEqual(ignored, {});
  } finally {
    if (prevData === undefined) delete process.env.PLUGIN_DATA;
    else process.env.PLUGIN_DATA = prevData;
  }

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('7. Scaffold generator produces a valid, self-contained new domain Swarm plugin', () => {
  if (process.env.SWARM_NESTED_TEST === '1') return;
  const tmp = makeTmpDir('agy-scaffold-');
  const currentSlug = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json'), 'utf8')).name;
  const targetSlug = currentSlug === 'research-swarm' ? 'content-swarm' : 'research-swarm';
  const outDir = path.join(tmp, `antigravity-${targetSlug}`);

  const res = scaffoldSwarm({
    sourceRoot: REPO_ROOT,
    targetRoot: outDir,
    slug: targetSlug,
    title: 'Deep Research Swarm',
    domain: 'deep research, competitive analysis',
    author: 'test-author',
    repoUrl: `https://github.com/test-author/antigravity-${targetSlug}`,
  });

  assert.equal(res.validation.ok, true);
  assert.equal(res.slug, targetSlug);
  assert.equal(fs.existsSync(path.join(outDir, 'plugin', 'skills', targetSlug, 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'plugin', 'skills', `${targetSlug}-planner`, 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'plugin', 'skills', `${targetSlug}-producer`, 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'plugin', 'skills', `${targetSlug}-verifier`, 'SKILL.md')), true);

  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, targetSlug);
  assert.equal(manifest.displayName, 'Deep Research Swarm');

  const briefs = fs.readFileSync(
    path.join(outDir, 'plugin', 'skills', targetSlug, 'references', 'brief-templates.md'),
    'utf8'
  );
  assert.equal(briefs.includes(`[swarm:${targetSlug}]`), true);

  const hooksCfg = JSON.parse(fs.readFileSync(path.join(outDir, 'plugin', 'hooks.json'), 'utf8'));
  assert.equal(Object.hasOwn(hooksCfg, `${targetSlug}-ownership-guard`), true);
  assert.equal(Object.hasOwn(hooksCfg, `${targetSlug}-delivery-gate`), true);

  // Verify the scaffolded repo's own test suite passes cleanly (with recursion guard)
  const testRun = spawnSync(process.execPath, ['--test', 'tests/template-plugin.test.mjs'], {
    cwd: outDir,
    encoding: 'utf8',
    env: { ...process.env, SWARM_NESTED_TEST: '1' },
  });
  assert.equal(testRun.status, 0, `Scaffolded repo tests failed:\n${testRun.stdout}\n${testRun.stderr}`);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('8. Validator rejects Antigravity spec violations (unknown fields, frontmatter in AGENTS.md, bad Stop shape)', () => {
  const tmp = makeTmpDir('agy-bad-plugin-');
  const badPlugin = path.join(tmp, 'plugin');
  fs.mkdirSync(path.join(badPlugin, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(badPlugin, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(badPlugin, 'skills', 'bad-swarm'), { recursive: true });

  fs.writeFileSync(
    path.join(badPlugin, 'plugin.json'),
    JSON.stringify({
      name: 'bad-swarm',
      description: 'Broken plugin for negative validation tests.',
      customUnsupportedField: true,
      suggestedPrompts: ['a', 'b', 'c', 'd'],
    })
  );
  fs.writeFileSync(path.join(badPlugin, 'rules', 'AGENTS.md'), '---\nname: invalid\n---\n# Bad rule\n');
  fs.writeFileSync(path.join(badPlugin, 'hooks', 'hooks.json'), '{}');
  fs.writeFileSync(
    path.join(badPlugin, 'hooks.json'),
    JSON.stringify({
      'unprefixed-stop': {
        Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'node ./hooks/missing.mjs' }] }],
      },
    })
  );
  fs.writeFileSync(
    path.join(badPlugin, 'skills', 'bad-swarm', 'SKILL.md'),
    '---\nname: bad-swarm\ndescription: test\n---\n# Body\n'
  );

  const res = validatePlugin(badPlugin);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('unsupported top-level field "customUnsupportedField"')));
  assert.ok(res.errors.some((e) => e.includes('at most 3 items')));
  assert.ok(res.errors.some((e) => e.includes('without YAML frontmatter')));
  assert.ok(res.errors.some((e) => e.includes('Misplaced hooks/hooks.json')));
  assert.ok(res.errors.some((e) => e.includes('FLAT handler array')));
  assert.ok(res.warnings.some((w) => w.includes('prefixed with "bad-swarm-"')));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('9. Coordinator immunity: Coordinator loading orchestrator SKILL.md and briefing @lead-planner is NEVER misidentified as a worker', () => {
  const tmp = makeTmpDir('agy-coord-');
  const stateDir = path.join(tmp, 'plugin-data');
  fs.mkdirSync(path.join(tmp, '.viral-media-swarm'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.viral-media-swarm', 'ownership.json'),
    JSON.stringify({
      'lead-planner': { allow: ['work/plan/**'], deny: ['work/deliverables/**'] },
    })
  );

  const coordTranscript = path.join(tmp, 'coordinator.jsonl');
  fs.writeFileSync(
    coordTranscript,
    [
      JSON.stringify({ type: 'USER_INPUT', content: '/swarm 启动 viral-media-swarm 团队完成任务' }),
      JSON.stringify({
        type: 'TOOL_CALL',
        tool_calls: [{ name: 'read_file', args: { Path: path.join(PLUGIN_DIR, 'skills', 'viral-media-swarm', 'SKILL.md') } }],
      }),
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        content: '已拉起 @lead-planner [swarm:viral-media-swarm] 负责规划。',
      }),
    ].join('\n') + '\n'
  );

  const out = runNodeHook(
    PRE_TOOL_HOOK,
    {
      conversationId: 'conv-coord-main',
      transcriptPath: coordTranscript,
      cwd: tmp,
      toolCall: { name: 'write_file', args: { Path: path.join(tmp, 'work', 'deliverables', 'final-summary.md') } },
    },
    { PLUGIN_ROOT: PLUGIN_DIR, PLUGIN_DATA: stateDir }
  );
  assert.equal(out.decision, 'allow');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('10. Multi-turn Stop gate: retains loadedSkill across swarm_wait wakeups and inspects post_message board verdicts', () => {
  const tmp = makeTmpDir('agy-multiturn-');
  const stateDir = path.join(tmp, 'plugin-data');
  const env = { PLUGIN_ROOT: PLUGIN_DIR, PLUGIN_DATA: stateDir };
  const slug = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json'), 'utf8')).name;

  const transcript = path.join(tmp, 'auditor-multiturn.jsonl');
  // Turn 1: reads verifier SKILL.md, posts VERDICT: REVISE, parks via swarm_wait.
  // Turn 2: wakes up, does NOT re-read SKILL.md, finishes without VERDICT -> MUST STILL BLOCK!
  const turn1AndBadTurn2 = [
    JSON.stringify({ type: 'USER_INPUT', content: `@auditor [swarm:${slug}] review deliverables` }),
    JSON.stringify({
      type: 'TOOL_CALL',
      tool_calls: [{ name: 'read_file', args: { Path: `/plugins/${slug}/skills/${slug}-verifier/SKILL.md` } }],
    }),
    JSON.stringify({
      type: 'TOOL_CALL',
      tool_calls: [{ name: 'post_message', args: { text: '@producer-1 VERDICT: REVISE — fix section 2' } }],
    }),
    JSON.stringify({
      type: 'TOOL_CALL',
      tool_calls: [{ name: 'swarm_wait', args: { since: 5, mentions_only: true } }],
    }),
    JSON.stringify({ type: 'TOOL_RESPONSE', content: '#8 @auditor revised section 2' }),
    JSON.stringify({ type: 'PLANNER_RESPONSE', content: 'Re-checked section 2, looks good now!' }),
  ];
  fs.writeFileSync(transcript, turn1AndBadTurn2.join('\n') + '\n');

  const blockedTurn2 = runNodeHook(
    STOP_HOOK,
    {
      conversationId: 'conv-multi-1',
      transcriptPath: transcript,
      terminationReason: 'NO_TOOL_CALL',
      fullyIdle: true,
      continuationActive: false,
    },
    env
  );
  assert.equal(blockedTurn2.decision, 'continue');
  assert.match(blockedTurn2.reason, /VERDICT: PASS/);

  // Turn 3: wakes from another swarm_wait and delivers VERDICT: PASS inside `post_message` tool args
  const turn3PassViaBoard = [
    ...turn1AndBadTurn2,
    JSON.stringify({
      type: 'TOOL_CALL',
      tool_calls: [{ name: 'swarm_wait', args: { since: 9, mentions_only: true } }],
    }),
    JSON.stringify({ type: 'TOOL_RESPONSE', content: '#11 @auditor final check' }),
    JSON.stringify({
      type: 'TOOL_CALL',
      tool_calls: [
        {
          name: 'post_message',
          args: { text: '@coordinator [done] VERDICT: PASS — audit report at work/reviews/audit-report.md' },
        },
      ],
    }),
    JSON.stringify({ type: 'PLANNER_RESPONSE', content: 'Posted final approval to the swarm board.' }),
  ];
  fs.writeFileSync(transcript, turn3PassViaBoard.join('\n') + '\n');

  const passedTurn3 = runNodeHook(
    STOP_HOOK,
    {
      conversationId: 'conv-multi-1',
      transcriptPath: transcript,
      terminationReason: 'NO_TOOL_CALL',
      fullyIdle: true,
      continuationActive: false,
    },
    env
  );
  assert.deepEqual(passedTurn3, {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('11. Anti-hallucination filesystem verification: planner claiming PLAN_STATUS: READY without writing ownership.json on disk is caught', () => {
  const tmp = makeTmpDir('agy-fscheck-');
  const stateDir = path.join(tmp, 'plugin-data');
  const env = { PLUGIN_ROOT: PLUGIN_DIR, PLUGIN_DATA: stateDir };
  const slug = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json'), 'utf8')).name;

  const plannerTranscript = path.join(tmp, 'planner.jsonl');
  fs.writeFileSync(
    plannerTranscript,
    [
      JSON.stringify({ type: 'USER_INPUT', content: `@lead-planner [swarm:${slug}] plan task` }),
      JSON.stringify({
        type: 'TOOL_CALL',
        tool_calls: [{ name: 'read_file', args: { Path: `/plugins/${slug}/skills/${slug}-planner/SKILL.md` } }],
      }),
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        content: `PLAN_STATUS: READY\nCreated work/plan/spec.md and .${slug}/ownership.json`,
      }),
    ].join('\n') + '\n'
  );

  // Files do NOT exist in `tmp` yet -> blocked!
  const hallucinated = runNodeHook(
    STOP_HOOK,
    {
      conversationId: 'conv-planner-halluc',
      transcriptPath: plannerTranscript,
      cwd: tmp,
      terminationReason: 'NO_TOOL_CALL',
      fullyIdle: true,
      continuationActive: false,
    },
    env
  );
  assert.equal(hallucinated.decision, 'continue');
  assert.match(hallucinated.reason, /not found on disk/);

  // Now actually write work/plan/spec.md and .<slug>/ownership.json -> passes on fresh conversation!
  fs.mkdirSync(path.join(tmp, 'work', 'plan'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'work', 'plan', 'spec.md'), '# Spec\n');
  fs.mkdirSync(path.join(tmp, `.${slug}`), { recursive: true });
  fs.writeFileSync(path.join(tmp, `.${slug}`, 'ownership.json'), '{}');

  const verified = runNodeHook(
    STOP_HOOK,
    {
      conversationId: 'conv-planner-real',
      transcriptPath: plannerTranscript,
      cwd: tmp,
      terminationReason: 'NO_TOOL_CALL',
      fullyIdle: true,
      continuationActive: false,
    },
    env
  );
  assert.deepEqual(verified, {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('12. Scaffold supports --force into pre-initialized Git repos and strips accidental antigravity- prefix', () => {
  if (process.env.SWARM_NESTED_TEST === '1') return;
  const tmp = makeTmpDir('agy-force-scaffold-');
  const existingRepo = path.join(tmp, 'antigravity-demo-domain-swarm');
  fs.mkdirSync(path.join(existingRepo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(existingRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(existingRepo, 'README.md'), '# Placeholder\n');

  const res = scaffoldSwarm({
    sourceRoot: REPO_ROOT,
    targetRoot: existingRepo,
    slug: 'antigravity-demo-domain-swarm',
    title: 'Demo Domain Swarm',
    domain: 'demo domain tasks',
    force: true,
  });

  assert.equal(res.slug, 'demo-domain-swarm');
  assert.equal(res.validation.ok, true);
  assert.equal(fs.existsSync(path.join(existingRepo, '.git', 'HEAD')), true);
  const pkg = JSON.parse(fs.readFileSync(path.join(existingRepo, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'antigravity-demo-domain-swarm');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('13. Orchestrator SKILL.md and brief templates include open_board, title, 3-Strike breaker, and Screenshot protocol', () => {
  const slug = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json'), 'utf8')).name;
  const orchMd = fs.readFileSync(path.join(PLUGIN_DIR, 'skills', slug, 'SKILL.md'), 'utf8');
  const briefsMd = fs.readFileSync(path.join(PLUGIN_DIR, 'skills', slug, 'references', 'brief-templates.md'), 'utf8');

  assert.match(orchMd, /open_board/);
  assert.match(orchMd, /action:\s*"title"/);
  assert.match(orchMd, /3-Strike/);
  assert.match(orchMd, /Screenshot:/);
  assert.match(briefsMd, /\[escalate\]/);
  assert.match(briefsMd, /Screenshot:/);
});
