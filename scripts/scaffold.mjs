#!/usr/bin/env node
/**
 * One-command Domain Swarm Generator (`npm run scaffold`).
 *
 * Modes:
 *   1. Generate into a new sibling folder:
 *      npm run scaffold -- --slug research-swarm --title "Deep Research Swarm" --domain "deep research, competitive analysis" --out ../antigravity-research-swarm
 *   2. Rename in-place (after clicking GitHub "Use this template"):
 *      npm run scaffold -- --slug research-swarm --title "Deep Research Swarm" --domain "deep research" --in-place
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validatePlugin } from './validate-plugin.mjs';

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

const EXCLUDE_TOP = new Set(['.git', 'node_modules']);
const TEXT_EXT_RE = /\.(md|json|mjs|js|ps1|sh|yml|yaml|svg)$/i;

function copyTree(src, dst, isTop = true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (isTop && EXCLUDE_TOP.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(s, d, false);
    else fs.copyFileSync(s, d);
  }
}

function replaceInTree(dir, replacer, isTop = true) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (isTop && EXCLUDE_TOP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      replaceInTree(full, replacer, false);
    } else if (TEXT_EXT_RE.test(entry.name)) {
      const before = fs.readFileSync(full, 'utf8');
      const after = replacer(before, full);
      if (after !== before) fs.writeFileSync(full, after, 'utf8');
    }
  }
}

export function scaffoldSwarm({ sourceRoot, targetRoot, slug: rawSlug, title, domain, author, repoUrl, force = false }) {
  const slug = String(rawSlug || '').trim().replace(/^antigravity-/i, '');
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
    throw new Error(`Invalid --slug "${rawSlug}". Must be lowercase kebab-case (2-41 chars, e.g. "research-swarm").`);
  }
  const resolvedSource = path.resolve(sourceRoot);
  const resolvedTarget = path.resolve(targetRoot);

  const srcManifestPath = path.join(resolvedSource, 'plugin', 'plugin.json');
  const srcManifest = fs.existsSync(srcManifestPath)
    ? JSON.parse(fs.readFileSync(srcManifestPath, 'utf8'))
    : { name: 'my-swarm', displayName: 'My Domain Swarm (Antigravity Template)' };
  const currentSlug = srcManifest.name || 'my-swarm';
  const currentDisplay = srcManifest.displayName || 'My Domain Swarm (Antigravity Template)';

  if (['all', 'coordinator', currentSlug].includes(slug)) {
    throw new Error(`--slug "${slug}" is reserved or identical to current slug "${currentSlug}"; pick a new domain slug.`);
  }

  const displayTitle = title || slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const domainDesc = domain || `${displayTitle} workflows`;

  if (resolvedSource !== resolvedTarget) {
    if (fs.existsSync(resolvedTarget) && !force) {
      const nonGitEntries = fs.readdirSync(resolvedTarget).filter((n) => n !== '.git');
      if (nonGitEntries.length > 0) {
        throw new Error(`Target directory already exists and is not empty: ${resolvedTarget} (pass --force to populate an existing repo).`);
      }
    }
    copyTree(resolvedSource, resolvedTarget);
  }

  // 1. Rename skill directories dynamically from currentSlug -> slug
  const skillsDir = path.join(resolvedTarget, 'plugin', 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === currentSlug || entry.name.startsWith(`${currentSlug}-`)) {
        const suffix = entry.name.slice(currentSlug.length);
        const oldPath = path.join(skillsDir, entry.name);
        const newPath = path.join(skillsDir, `${slug}${suffix}`);
        if (oldPath !== newPath) fs.renameSync(oldPath, newPath);
      }
    }
  }

  // 2. Replace identifiers cleanly across template files (skipping scaffold.mjs itself)
  const scaffoldSelf = path.join(resolvedTarget, 'scripts', 'scaffold.mjs');
  replaceInTree(resolvedTarget, (content, filePath) => {
    if (path.resolve(filePath) === path.resolve(scaffoldSelf)) return content;
    let out = content
      .replaceAll(currentDisplay, displayTitle)
      .replaceAll('My Domain Swarm', displayTitle)
      .replaceAll('<REPLACE_WITH_YOUR_DOMAIN_KEYWORDS>', domainDesc)
      .replaceAll('antigravity-swarm-template', `antigravity-${slug}`)
      .replaceAll(`antigravity-${currentSlug}`, `antigravity-${slug}`)
      .replaceAll(currentSlug, slug);
    if (author) {
      out = out.replaceAll('cxbrucewayen', author);
    }
    return out;
  });

  // 3. Patch plugin.json metadata cleanly if custom repoUrl or author provided
  const manifestPath = path.join(resolvedTarget, 'plugin', 'plugin.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.name = slug;
    manifest.displayName = displayTitle;
    manifest.description = `Domain-specific multi-agent /swarm plugin for ${domainDesc} on Google Antigravity 2.0, with coexistence-safe rules, scoped file-ownership hooks, and delivery contract gates.`;
    if (repoUrl) {
      manifest.homepage = repoUrl;
      manifest.repository = { type: 'git', url: repoUrl };
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }

  const pkgPath = path.join(resolvedTarget, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.name = `antigravity-${slug}`;
    pkg.description = `Google Antigravity 2.0 multi-agent /swarm plugin for ${domainDesc}.`;
    if (repoUrl) {
      pkg.homepage = `${repoUrl}#readme`;
      pkg.repository = { type: 'git', url: `${repoUrl}.git` };
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  const validation = validatePlugin(path.join(resolvedTarget, 'plugin'));
  if (!validation.ok) {
    throw new Error(`Scaffolded plugin failed validation:\n${validation.errors.join('\n')}`);
  }
  return { targetRoot: resolvedTarget, slug, displayTitle, validation };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.slug || (!args.out && !args['in-place'])) {
    console.log(`Usage:
  npm run scaffold -- --slug <kebab-slug> --title "<Display Name>" --domain "<keywords>" --out <target-dir>
  npm run scaffold -- --slug <kebab-slug> --title "<Display Name>" --domain "<keywords>" --in-place

Optional flags:
  --force                  Populate an existing repository directory (preserves .git)
  --author <github-handle>
  --repo <https://github.com/you/your-repo>`);
    process.exit(args.help ? 0 : 2);
  }
  const sourceRoot = path.resolve(import.meta.dirname, '..');
  const targetRoot = args['in-place'] ? sourceRoot : path.resolve(process.cwd(), String(args.out));
  const res = scaffoldSwarm({
    sourceRoot,
    targetRoot,
    slug: String(args.slug).trim(),
    title: args.title ? String(args.title) : undefined,
    domain: args.domain ? String(args.domain) : undefined,
    author: args.author ? String(args.author) : undefined,
    repoUrl: args.repo ? String(args.repo) : undefined,
    force: Boolean(args.force),
  });
  console.log(`SUCCESS! Generated Antigravity Swarm plugin "${res.slug}" (${res.displayTitle}) at:\n  ${res.targetRoot}`);
  console.log('\nNext steps:');
  console.log(`  1. cd "${res.targetRoot}"`);
  console.log('  2. Customize skills, role invariants (plugin/hooks/lib-swarm-scope.mjs), and stop contracts (plugin/hooks/stop-gate.mjs).');
  console.log('  3. Run: npm run validate && npm test');
  console.log('  4. Install locally: pwsh ./install.ps1 (Windows) or bash ./install.sh (macOS/Linux)');
}
