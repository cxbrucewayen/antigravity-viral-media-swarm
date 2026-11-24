#!/usr/bin/env node
/**
 * Self-contained CLI helper for managing THIS plugin's session-scoped freezes and explicit worker locks.
 * Workers invoke it directly via: `node "$PLUGIN_ROOT/hooks/swarm-lock-cli.mjs" <subcommand> ...`
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  checkSwarmOwnership,
  freezeSessionsDir,
  locksDir,
  pluginSlug,
  sanitizeId,
} from './lib-swarm-scope.mjs';

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[k] = true;
      else {
        out[k] = next;
        i++;
      }
    }
  }
  return out;
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
const slug = pluginSlug();

if (cmd === 'set') {
  const id = String(flags.id || process.env.ANTIGRAVITY_CONVERSATION_ID || '');
  if (!id) {
    console.error(
      'Usage: node swarm-lock-cli.mjs set --id <conversationId> --allow "dir1/**,dir2/**" [--deny "dir3/**"] [--worker <name>] [--cwd <dir>]'
    );
    process.exit(2);
  }
  const allow = flags.allow ? String(flags.allow).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const deny = flags.deny ? String(flags.deny).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const record = {
    plugin: slug,
    id,
    worker: flags.worker || id,
    cwd: path.resolve(String(flags.cwd || process.cwd())),
    allow,
    deny,
    updatedAt: new Date().toISOString(),
  };
  const f = path.join(locksDir(), `${sanitizeId(id)}.json`);
  fs.writeFileSync(f, JSON.stringify(record, null, 2));
  console.log(`SWARM_LOCK_SET [${slug}]: ${f} (allow=${allow.join('|') || '*'} deny=${deny.join('|') || 'none'})`);
} else if (cmd === 'clear') {
  const dir = locksDir();
  if (flags.all) {
    for (const e of fs.readdirSync(dir)) {
      if (e.endsWith('.json')) fs.unlinkSync(path.join(dir, e));
    }
    console.log(`SWARM_LOCK_CLEARED [${slug}]: all`);
  } else if (flags.id) {
    const f = path.join(dir, `${sanitizeId(flags.id)}.json`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    console.log(`SWARM_LOCK_CLEARED [${slug}]: ${flags.id}`);
  } else {
    console.error('Usage: node swarm-lock-cli.mjs clear --id <id> | --all');
    process.exit(2);
  }
} else if (cmd === 'freeze-session') {
  const id = String(flags.session || flags.id || '');
  const targetDir = String(flags.dir || rest[0] || process.cwd());
  if (!id) {
    console.error('Usage: node swarm-lock-cli.mjs freeze-session --session <conversationId> --dir <path>');
    process.exit(2);
  }
  const f = path.join(freezeSessionsDir(), `${sanitizeId(id)}.txt`);
  fs.writeFileSync(f, path.resolve(targetDir) + '\n');
  console.log(`SESSION_FREEZE_SET [${slug}]: session=${id} dir=${path.resolve(targetDir)}`);
} else if (cmd === 'unfreeze-session') {
  const dir = freezeSessionsDir();
  if (flags.all) {
    for (const e of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, e));
    console.log(`SESSION_FREEZE_CLEARED [${slug}]: all`);
  } else if (flags.session || flags.id) {
    const id = String(flags.session || flags.id);
    const f = path.join(dir, `${sanitizeId(id)}.txt`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    console.log(`SESSION_FREEZE_CLEARED [${slug}]: ${id}`);
  } else {
    console.error('Usage: node swarm-lock-cli.mjs unfreeze-session --session <id> | --all');
    process.exit(2);
  }
} else if (cmd === 'list') {
  const dir = locksDir();
  const files = fs.readdirSync(dir).filter((e) => e.endsWith('.json') && !e.startsWith('.'));
  if (!files.length) console.log(`SWARM_LOCKS [${slug}]: none`);
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    console.log(`${r.id}\tworker=${r.worker}\tallow=[${(r.allow || []).join(', ')}]\tdeny=[${(r.deny || []).join(', ')}]\tcwd=${r.cwd}`);
  }
} else if (cmd === 'check') {
  const res = checkSwarmOwnership({
    conversationId: String(flags.id || ''),
    transcriptPath: flags.transcript ? String(flags.transcript) : undefined,
    filePath: String(flags.file || ''),
    cwd: flags.cwd ? String(flags.cwd) : process.cwd(),
  });
  console.log(JSON.stringify(res));
  process.exit(res.allowed ? 0 : 1);
} else {
  console.log('Commands: set | clear | list | check | freeze-session | unfreeze-session');
}
