#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { json: false, limit: 30 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('-') && !options.target) options.target = arg;
    else if (arg === '--owner') options.owner = argv[++index];
    else if (arg === '--member') options.member = argv[++index];
    else if (arg === '--limit') options.limit = Number.parseInt(argv[++index], 10);
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node query-phaser-api.mjs <project-or-phaser-root> --owner <ClassOrInterface> --member <name> [--json]',
    '',
    'Examples:',
    '  node query-phaser-api.mjs . --owner GameObjectFactory --member mesh2d --json',
    '  node query-phaser-api.mjs . --owner Mesh2D --member setTint2',
  ].join('\n');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function resolvePhaserRoot(target) {
  const root = path.resolve(target);
  const candidates = [root, path.join(root, 'node_modules', 'phaser')];
  for (const candidate of candidates) {
    const packageFile = path.join(candidate, 'package.json');
    if (!(await exists(packageFile))) continue;
    const packageJson = JSON.parse(await readFile(packageFile, 'utf8'));
    if (packageJson.name === 'phaser') return { root: candidate, packageJson };
  }
  throw new Error(`Cannot resolve a Phaser package from ${root}`);
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function findScopeEnd(content, openBraceIndex) {
  let depth = 0;
  for (let index = openBraceIndex; index < content.length; index += 1) {
    if (content[index] === '{') depth += 1;
    else if (content[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return content.length;
}

function namespaceContext(content, scopeIndex) {
  const prefix = content.slice(0, scopeIndex);
  const matches = [...prefix.matchAll(/^\s*(?:namespace|module)\s+([^\s{]+)\s*\{/gm)];
  return matches.slice(-4).map((match) => match[1]).join('.');
}

function declarationMatches(content, owner, member, declarationPath) {
  const ownerPattern = new RegExp(`^\\s*(class|interface)\\s+${escapeRegex(owner)}(?:\\s|<|extends|\\{)`, 'gm');
  const memberPattern = new RegExp(`\\b${escapeRegex(member)}\\b`);
  const results = [];
  for (const ownerMatch of content.matchAll(ownerPattern)) {
    const openBrace = content.indexOf('{', ownerMatch.index);
    const end = findScopeEnd(content, openBrace);
    const body = content.slice(openBrace + 1, end);
    for (const lineMatch of body.matchAll(/^.*$/gm)) {
      if (!memberPattern.test(lineMatch[0])) continue;
      const trimmed = lineMatch[0].trim();
      if (!trimmed || trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
      const absoluteIndex = openBrace + 1 + lineMatch.index;
      results.push({
        path: declarationPath,
        line: lineNumberAt(content, absoluteIndex),
        owner,
        ownerKind: ownerMatch[1],
        namespace: namespaceContext(content, ownerMatch.index),
        text: trimmed,
      });
    }
  }
  return results;
}

async function walk(root, extension, output = []) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(full, extension, output);
    else if (entry.name.endsWith(extension)) output.push(full);
  }
  return output;
}

function sourcePatterns(member) {
  const escaped = escapeRegex(member);
  return [
    new RegExp(`(?:GameObjectFactory|GameObjectCreator)\\.register\\(['\"]${escaped}['\"]`),
    new RegExp(`\\b${escaped}\\s*:\\s*function\\b`),
    new RegExp(`@method\\s+[^\\n#]*#${escaped}\\b`),
    new RegExp(`^\\s*${escaped}\\s*\\(`),
  ];
}

async function findSourceMatches(phaserRoot, owner, member, limit) {
  const sourceRoot = path.join(phaserRoot, 'src');
  if (!(await exists(sourceRoot))) return [];
  const patterns = sourcePatterns(member);
  const ownerLower = owner.toLowerCase();
  const matches = [];
  for (const file of await walk(sourceRoot, '.js')) {
    const content = await readFile(file, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!patterns.some((pattern) => pattern.test(lines[index]))) continue;
      const relative = path.relative(phaserRoot, file).replaceAll('\\', '/');
      const ownerEvidence = content.includes(`#${member}`) && content.toLowerCase().includes(ownerLower);
      const pathEvidence = relative.toLowerCase().includes(ownerLower);
      matches.push({
        path: relative,
        line: index + 1,
        text: lines[index].trim(),
        ownerEvidence: ownerEvidence || pathEvidence,
      });
    }
  }
  return matches
    .sort((left, right) => Number(right.ownerEvidence) - Number(left.ownerEvidence) || left.path.localeCompare(right.path))
    .slice(0, limit);
}

async function findKnownDivergences(member) {
  const anchorFile = path.join(skillRoot, 'references', 'api-anchors.json');
  if (!(await exists(anchorFile))) return [];
  const anchors = JSON.parse(await readFile(anchorFile, 'utf8'));
  const needle = member.toLowerCase();
  return (anchors.knownDivergences ?? [])
    .filter((item) => JSON.stringify(item).toLowerCase().includes(needle))
    .map((item) => ({ id: item.id, description: item.description, since: item.since, until: item.until }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.target || !options.owner || !options.member) throw new Error(usage());
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200) {
    throw new Error('--limit must be an integer from 1 to 200');
  }

  const resolved = await resolvePhaserRoot(options.target);
  const declarationRelative = resolved.packageJson.types?.replace(/^\.\//, '') ?? 'types/phaser.d.ts';
  const declarationFile = path.join(resolved.root, declarationRelative);
  const declarationContent = await readFile(declarationFile, 'utf8');
  const declarations = declarationMatches(
    declarationContent,
    options.owner,
    options.member,
    declarationRelative.replaceAll('\\', '/'),
  ).slice(0, options.limit);
  const sources = await findSourceMatches(resolved.root, options.owner, options.member, options.limit);
  const knownDivergences = await findKnownDivergences(options.member);

  const result = {
    phaserRoot: resolved.root,
    version: resolved.packageJson.version,
    owner: options.owner,
    member: options.member,
    declarationMatches: declarations,
    sourceMatches: sources,
    knownDivergences,
    summary: {
      declarations: declarations.length,
      sources: sources.length,
      knownDivergences: knownDivergences.length,
      status: declarations.length > 0 ? 'declared' : sources.length > 0 ? 'runtime-only-or-internal' : 'not-found',
    },
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Phaser ${result.version}: ${options.owner}#${options.member} (${result.summary.status})`);
    for (const match of declarations) console.log(`  declaration ${match.path}:${match.line} ${match.text}`);
    for (const match of sources) console.log(`  source ${match.path}:${match.line} ${match.text}`);
    for (const drift of knownDivergences) console.log(`  known divergence ${drift.id}: ${drift.description}`);
  }
  if (result.summary.status === 'not-found') process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
