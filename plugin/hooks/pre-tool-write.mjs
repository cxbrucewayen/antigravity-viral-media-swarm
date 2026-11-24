#!/usr/bin/env node
/**
 * Antigravity `PreToolUse` hook (`write_file|edit_file`):
 * Enforces coexistence-safe Swarm file-ownership boundaries and session-scoped freeze
 * strictly for sessions belonging to THIS plugin.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkSwarmOwnership, ownershipFilePath, sanitizeId, stateRoot } from './lib-swarm-scope.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let payload = {};
  try {
    payload = JSON.parse(raw || '{}');
    const filePath = payload?.toolCall?.args?.Path;
    if (typeof filePath !== 'string' || !filePath) {
      process.stdout.write('{"decision":"allow"}\n');
      return;
    }

    const cwd = payload?.cwd || process.cwd();
    const conversationId = payload?.conversationId || '';
    const transcriptPath = payload?.transcriptPath || '';

    const res = checkSwarmOwnership({ conversationId, transcriptPath, filePath, cwd });
    if (!res.allowed) {
      process.stdout.write(JSON.stringify({ decision: 'deny', reason: res.reason }) + '\n');
      return;
    }
    process.stdout.write('{"decision":"allow"}\n');
  } catch (err) {
    // Fail-closed ONLY if a lock/freeze/ownership file for THIS plugin is actually active
    const cwd = payload?.cwd || process.cwd();
    const convId = payload?.conversationId || '';
    const hasActiveGuard =
      fs.existsSync(ownershipFilePath(cwd)) ||
      (convId && fs.existsSync(path.join(stateRoot(), 'locks', `${sanitizeId(convId)}.json`))) ||
      (convId && fs.existsSync(path.join(stateRoot(), 'freeze-sessions', `${sanitizeId(convId)}.txt`)));

    if (hasActiveGuard) {
      process.stdout.write(
        JSON.stringify({
          decision: 'deny',
          reason: `[swarm-hook] Hook error while active guard is present (fail closed): ${err instanceof Error ? err.message : String(err)}`,
        }) + '\n'
      );
    } else {
      process.stdout.write('{"decision":"allow"}\n');
    }
  }
});
