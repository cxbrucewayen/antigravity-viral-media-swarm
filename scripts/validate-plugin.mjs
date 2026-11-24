#!/usr/bin/env node
/**
 * Antigravity Swarm Plugin Spec & Coexistence Validator.
 * Verifies official Antigravity 2.0 plugin constraints + multi-swarm coexistence best practices.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ALLOWED_PLUGIN_FIELDS = new Set([
  'name',
  'displayName',
  'version',
  'description',
  'logo',
  'suggestedPrompts',
  'author',
  'homepage',
  'repository',
  'disabled',
]);

const GROUPED_HOOK_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const FLAT_HOOK_EVENTS = new Set(['SessionStart', 'PreInvocation', 'PostInvocation', 'Stop']);
const GSTACK_COLLISION_RE = /^(pm-|qa-|reviewer)/i;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
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

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

export function validatePlugin(pluginDir) {
  const errors = [];
  const warnings = [];
  const root = path.resolve(pluginDir);

  if (!fs.existsSync(root)) {
    return { ok: false, errors: [`Plugin directory not found: ${root}`], warnings };
  }

  // 1. Validate plugin.json against Antigravity official allowlist
  const manifestPath = path.join(root, 'plugin.json');
  let manifest = null;
  if (!fs.existsSync(manifestPath)) {
    errors.push('Missing required plugin.json at plugin root.');
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      errors.push(`Invalid JSON in plugin.json: ${err.message}`);
    }
  }

  const pluginName = manifest?.name || '';
  if (manifest) {
    for (const key of Object.keys(manifest)) {
      if (!ALLOWED_PLUGIN_FIELDS.has(key)) {
        errors.push(`plugin.json contains unsupported top-level field "${key}" (Antigravity silently discards unknown fields).`);
      }
    }
    if (typeof pluginName !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(pluginName)) {
      errors.push(`plugin.json "name" must be lowercase kebab-case, got "${pluginName}".`);
    }
    if (typeof manifest.description !== 'string' || manifest.description.trim().length < 10) {
      errors.push('plugin.json "description" should be a clear one- or two-sentence summary.');
    }
    if (manifest.logo !== undefined) {
      if (typeof manifest.logo !== 'string' || /^https?:\/\//i.test(manifest.logo) || path.isAbsolute(manifest.logo)) {
        errors.push(`plugin.json "logo" must be a relative path inside the plugin directory, got "${manifest.logo}".`);
      } else if (!/\.(svg|png|jpg|jpeg|webp)$/i.test(manifest.logo)) {
        errors.push(`plugin.json "logo" must end in .svg/.png/.jpg/.jpeg/.webp, got "${manifest.logo}".`);
      } else if (!fs.existsSync(path.join(root, manifest.logo))) {
        errors.push(`plugin.json "logo" target does not exist: ${manifest.logo}`);
      }
    }
    if (manifest.suggestedPrompts !== undefined) {
      if (!Array.isArray(manifest.suggestedPrompts)) {
        errors.push('plugin.json "suggestedPrompts" must be an array of strings.');
      } else {
        if (manifest.suggestedPrompts.length > 3) {
          errors.push(`plugin.json "suggestedPrompts" supports at most 3 items (found ${manifest.suggestedPrompts.length}).`);
        }
        if (manifest.suggestedPrompts.some((p) => typeof p !== 'string' || !p.trim())) {
          errors.push('plugin.json "suggestedPrompts" must contain non-empty strings.');
        }
      }
    }
  }

  // 2. Validate rules/AGENTS.md (optional)
  const agentsRule = path.join(root, 'rules', 'AGENTS.md');
  if (fs.existsSync(agentsRule)) {
    const rawRule = fs.readFileSync(agentsRule, 'utf8');
    if (rawRule.trimStart().startsWith('---')) {
      errors.push('rules/AGENTS.md must be plain Markdown without YAML frontmatter.');
    }
    const byteLen = Buffer.byteLength(rawRule, 'utf8');
    if (byteLen > 24000) {
      errors.push(`rules/AGENTS.md exceeds Antigravity 24,000-byte per-file cap (${byteLen} bytes).`);
    } else if (byteLen > 2048) {
      warnings.push(`rules/AGENTS.md is ${byteLen} bytes; keep plugin always-on rules under ~2 KB to preserve the shared 20,000-token global rules budget.`);
    }
  }

  // 3. Validate hooks.json placement and structure (optional)
  const misplacedHooks = path.join(root, 'hooks', 'hooks.json');
  if (fs.existsSync(misplacedHooks)) {
    errors.push('Misplaced hooks/hooks.json detected: native Antigravity plugins MUST place hooks.json directly at the plugin root.');
  }
  const hooksPath = path.join(root, 'hooks.json');
  if (fs.existsSync(hooksPath)) {
    let hooksCfg = null;
    try {
      hooksCfg = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    } catch (err) {
      errors.push(`Invalid JSON in hooks.json: ${err.message}`);
    }
    if (hooksCfg && typeof hooksCfg === 'object') {
      for (const [hookKey, spec] of Object.entries(hooksCfg)) {
        if (pluginName && !hookKey.startsWith(`${pluginName}-`)) {
          warnings.push(`hooks.json key "${hookKey}" should be prefixed with "${pluginName}-" to prevent collisions with other plugins.`);
        }
        if (!spec || typeof spec !== 'object') {
          errors.push(`hooks.json entry "${hookKey}" must be an object.`);
          continue;
        }
        for (const [eventKey, val] of Object.entries(spec)) {
          if (eventKey === 'enabled') continue;
          if (GROUPED_HOOK_EVENTS.has(eventKey)) {
            if (!Array.isArray(val)) {
              errors.push(`hooks.json "${hookKey}.${eventKey}" must be an array of { matcher, hooks } groups.`);
              continue;
            }
            for (const grp of val) {
              if (!grp || typeof grp.matcher !== 'string' || !Array.isArray(grp.hooks)) {
                errors.push(`hooks.json "${hookKey}.${eventKey}" group requires "matcher" (string) and "hooks" (array).`);
                continue;
              }
              for (const h of grp.hooks) checkHookCommand(h, root, `${hookKey}.${eventKey}`, errors);
            }
          } else if (FLAT_HOOK_EVENTS.has(eventKey)) {
            if (!Array.isArray(val)) {
              errors.push(`hooks.json "${hookKey}.${eventKey}" must be a flat array of handler objects.`);
              continue;
            }
            for (const h of val) {
              if (h && Array.isArray(h.hooks)) {
                errors.push(`hooks.json "${hookKey}.${eventKey}" must be a FLAT handler array, not grouped with { matcher, hooks }.`);
              } else {
                checkHookCommand(h, root, `${hookKey}.${eventKey}`, errors);
              }
            }
          } else {
            errors.push(`hooks.json "${hookKey}" has unknown event key "${eventKey}".`);
          }
        }
      }
    }
  }

  // 4. Validate skills/*/SKILL.md
  const skillsDir = path.join(root, 'skills');
  if (!fs.existsSync(skillsDir)) {
    errors.push('Missing skills/ directory.');
  } else {
    const skillFolders = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    if (skillFolders.length === 0) {
      errors.push('skills/ directory contains no skill subdirectories.');
    }
    for (const dir of skillFolders) {
      const skillMd = path.join(skillsDir, dir.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) {
        errors.push(`Skill directory "skills/${dir.name}" is missing required SKILL.md.`);
        continue;
      }
      const text = fs.readFileSync(skillMd, 'utf8');
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      if (!fm) {
        errors.push(`skills/${dir.name}/SKILL.md is missing required YAML frontmatter.`);
        continue;
      }
      const nameMatch = /^name:\s*(.+)$/m.exec(fm[1]);
      const descMatch = /^description:\s*(.+)$/m.exec(fm[1]);
      if (!nameMatch) {
        errors.push(`skills/${dir.name}/SKILL.md frontmatter is missing "name".`);
      } else {
        const declared = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
        if (declared !== dir.name) {
          errors.push(`skills/${dir.name}/SKILL.md frontmatter name "${declared}" does not match folder name "${dir.name}".`);
        }
        if (!/^[a-z0-9][a-z0-9-]*$/.test(declared)) {
          errors.push(`skills/${dir.name}/SKILL.md name "${declared}" must be lowercase hyphenated.`);
        }
      }
      if (!descMatch) {
        errors.push(`skills/${dir.name}/SKILL.md frontmatter is missing "description".`);
      }
    }

    if (pluginName) {
      const orchSkill = path.join(skillsDir, pluginName, 'SKILL.md');
      if (!fs.existsSync(orchSkill)) {
        errors.push(`Missing orchestrator skill at skills/${pluginName}/SKILL.md.`);
      }
      const briefs = path.join(skillsDir, pluginName, 'references', 'brief-templates.md');
      if (fs.existsSync(briefs)) {
        const briefText = fs.readFileSync(briefs, 'utf8');
        if (!briefText.includes(`[swarm:${pluginName}]`)) {
          warnings.push(`skills/${pluginName}/references/brief-templates.md does not include "[swarm:${pluginName}]" isolation markers.`);
        }
      }
    }
  }

  // 5. Validate mcp_config.json (if present)
  const mcpPath = path.join(root, 'mcp_config.json');
  if (fs.existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      for (const srvName of Object.keys(mcp?.mcpServers || {})) {
        if (pluginName && !srvName.startsWith(`${pluginName}-`)) {
          warnings.push(`mcp_config.json server "${srvName}" should be prefixed with "${pluginName}-" (MCP server names are global).`);
        }
      }
    } catch (err) {
      errors.push(`Invalid JSON in mcp_config.json: ${err.message}`);
    }
  }

  // 6. Check zero hardcoded personal paths inside plugin/
  const personalPathRe = /(?:C:\\\\Users\\\\[a-zA-Z0-9._-]+|C:\\Users\\[a-zA-Z0-9._-]+|\/Users\/[a-zA-Z0-9._-]+\/|\/home\/[a-zA-Z0-9._-]+\/)/;
  for (const file of walkFiles(root)) {
    if (!/\.(mjs|js|ts|json|md|sh|ps1|svg)$/i.test(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (personalPathRe.test(content)) {
      errors.push(`Hardcoded personal home path detected in ${path.relative(root, file)}`);
    }
  }

  // 7. Check repo-level ownership example for gstack-swarm role collisions (advisory)
  const ownershipExample = path.resolve(root, '..', 'examples', 'swarm-ownership.example.json');
  if (fs.existsSync(ownershipExample)) {
    try {
      const map = JSON.parse(fs.readFileSync(ownershipExample, 'utf8'));
      for (const roleName of Object.keys(map)) {
        const clean = roleName.replace(/^@/, '');
        if (GSTACK_COLLISION_RE.test(clean)) {
          warnings.push(
            `Role "${clean}" in examples/swarm-ownership.example.json matches gstack-swarm's built-in role regex (pm-*/qa-*/reviewer*). Rename it (e.g. "${pluginName}-${clean}") to avoid cross-plugin collisions.`
          );
        }
      }
    } catch (err) {
      errors.push(`Invalid JSON in examples/swarm-ownership.example.json: ${err.message}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, pluginName };
}

function checkHookCommand(handler, pluginDir, loc, errors) {
  if (!handler || typeof handler.command !== 'string' || !handler.command.trim()) {
    errors.push(`hooks.json "${loc}" handler is missing required "command" string.`);
    return;
  }
  const relScript = /\.\/([a-zA-Z0-9_./-]+\.(?:mjs|js|sh|ps1))/.exec(handler.command);
  if (relScript) {
    const target = path.join(pluginDir, relScript[1]);
    if (!fs.existsSync(target)) {
      errors.push(`hooks.json "${loc}" references missing script "./${relScript[1]}".`);
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const targetDir = args.plugin || path.resolve(import.meta.dirname, '..', 'plugin');
  const res = validatePlugin(targetDir);

  if (res.warnings.length > 0) {
    console.warn(`Warnings (${res.warnings.length}):`);
    for (const w of res.warnings) console.warn(`  - [WARN] ${w}`);
  }
  if (!res.ok) {
    console.error(`Validation FAILED (${res.errors.length} error(s)):`);
    for (const e of res.errors) console.error(`  - [ERROR] ${e}`);
    process.exit(1);
  }
  console.log(`Validation PASSED for Antigravity Swarm plugin "${res.pluginName}" (${targetDir}).`);
}
