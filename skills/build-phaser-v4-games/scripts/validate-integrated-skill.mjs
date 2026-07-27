#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultSkillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { skillRoot: defaultSkillRoot, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--skill-root') options.skillRoot = path.resolve(argv[++index]);
    else if (arg === '--phaser-root') options.phaserRoot = path.resolve(argv[++index]);
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return 'Usage: node validate-integrated-skill.mjs [--skill-root <dir>] [--phaser-root <dir>] [--json]';
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function walk(root, predicate = () => true, output = []) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(full, predicate, output);
    else if (predicate(full)) output.push(full);
  }
  return output;
}

function markdownTargets(content) {
  return [...content.matchAll(/\[[^\]]*\]\(([^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
}

async function runtimeFactories(phaserRoot) {
  const add = new Set(['existing']);
  const make = new Set();
  const sourceRoot = path.join(phaserRoot, 'src');
  for (const file of await walk(sourceRoot, (candidate) => candidate.endsWith('.js'))) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(/GameObjectFactory\.register\(['"]([^'"]+)/g)) add.add(match[1]);
    for (const match of content.matchAll(/GameObjectCreator\.register\(['"]([^'"]+)/g)) make.add(match[1]);
  }
  return { add, make };
}

function documentedFactoryCalls(content) {
  const calls = [];
  for (const kind of ['add', 'make']) {
    const pattern = new RegExp(`this\\.${kind}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
    for (const match of content.matchAll(pattern)) calls.push({ kind, member: match[1] });
  }
  return calls;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const errors = [];
  const warnings = [];
  const checks = [];
  const skillRoot = options.skillRoot;

  const skillEntries = await walk(skillRoot, (file) => path.basename(file) === 'SKILL.md');
  if (skillEntries.length !== 1 || path.resolve(skillEntries[0]) !== path.join(skillRoot, 'SKILL.md')) {
    errors.push(`Expected exactly one root SKILL.md, found ${skillEntries.length}`);
  }
  checks.push({ name: 'single-entry', value: skillEntries.length });

  const manifestFile = path.join(skillRoot, 'references', 'official', '4.2.1', 'manifest.json');
  if (!(await exists(manifestFile))) throw new Error(`Missing ${manifestFile}`);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (manifest.topicCount !== 28 || manifest.files?.length !== 28) {
    errors.push(`Expected 28 manifest topics, found ${manifest.topicCount}/${manifest.files?.length}`);
  }
  checks.push({ name: 'official-topics', value: manifest.topicCount });

  const mainSkill = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const requiredRoutes = [
    'references/official-topic-index.md',
    'references/official-corrections-4.2.1.md',
    'scripts/query-phaser-api.mjs',
    'scripts/validate-integrated-skill.mjs',
  ];
  for (const route of requiredRoutes) {
    if (!mainSkill.includes(route)) errors.push(`Root SKILL.md does not route ${route}`);
  }

  const indexFile = path.join(skillRoot, 'references', 'official-topic-index.md');
  const indexContent = await readFile(indexFile, 'utf8');
  for (const item of manifest.files) {
    const expected = `official/4.2.1/${item.topic}/topic.md`;
    if (!indexContent.includes(expected)) errors.push(`Topic index does not route ${item.topic}`);
    if (!(await exists(path.join(skillRoot, 'references', expected)))) errors.push(`Missing vendored topic ${expected}`);
  }

  const markdownFiles = await walk(skillRoot, (file) => file.endsWith('.md'));
  let brokenLinks = 0;
  let unbalancedFences = 0;
  let longWithoutContents = 0;
  for (const file of markdownFiles) {
    const content = await readFile(file, 'utf8');
    const relative = path.relative(skillRoot, file).replaceAll('\\', '/');
    const fenceCount = (content.match(/^```/gm) ?? []).length;
    if (fenceCount % 2 !== 0) {
      unbalancedFences += 1;
      errors.push(`Unbalanced code fences in ${relative}`);
    }
    const lineCount = content.split(/\r?\n/).length;
    if (lineCount > 300 && !/^## (?:Table of )?Contents\s*$/im.test(content)) {
      longWithoutContents += 1;
      errors.push(`Long reference lacks contents section: ${relative} (${lineCount} lines)`);
    }
    for (const target of markdownTargets(content)) {
      if (/^(?:https?:|mailto:|#|<)/.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), target);
      if (!(await exists(resolved))) {
        brokenLinks += 1;
        errors.push(`Broken link in ${relative}: ${target}`);
      }
    }
  }
  checks.push({ name: 'markdown-files', value: markdownFiles.length });
  checks.push({ name: 'broken-links', value: brokenLinks });
  checks.push({ name: 'unbalanced-fences', value: unbalancedFences });
  checks.push({ name: 'long-without-contents', value: longWithoutContents });

  const officialRoot = path.join(skillRoot, 'references', 'official', '4.2.1');
  const officialMarkdown = await walk(officialRoot, (file) => file.endsWith('.md'));
  const forbidden = /this\.add\.(?:noiseCell2D|noiseCell3D|noiseCell4D|noiseSimplex2D|noiseSimplex3D)\s*\(/;
  for (const file of officialMarkdown) {
    const content = await readFile(file, 'utf8');
    if (forbidden.test(content)) errors.push(`Uncorrected Noise factory in ${path.relative(skillRoot, file)}`);
  }

  if (options.phaserRoot) {
    const packageJson = JSON.parse(await readFile(path.join(options.phaserRoot, 'package.json'), 'utf8'));
    if (packageJson.version !== manifest.phaserVersion) {
      errors.push(`Manifest Phaser ${manifest.phaserVersion} does not match source ${packageJson.version}`);
    }
    for (const item of manifest.files) {
      const sourceSkill = await readFile(path.join(options.phaserRoot, item.sourceSkill), 'utf8');
      if (sha256(sourceSkill) !== item.sourceSkillSha256) errors.push(`Upstream hash drift: ${item.sourceSkill}`);
      if (item.sourceReference) {
        const sourceReference = await readFile(path.join(options.phaserRoot, item.sourceReference), 'utf8');
        if (sha256(sourceReference) !== item.sourceReferenceSha256) errors.push(`Upstream hash drift: ${item.sourceReference}`);
      }
    }

    const factories = await runtimeFactories(options.phaserRoot);
    const allowedCustomFactories = new Set(['myObject', 'laserBeam']);
    for (const file of officialMarkdown) {
      const content = await readFile(file, 'utf8');
      for (const call of documentedFactoryCalls(content)) {
        if (!factories[call.kind].has(call.member) && !allowedCustomFactories.has(call.member)) {
          errors.push(`Unregistered runtime factory in ${path.relative(skillRoot, file)}: this.${call.kind}.${call.member}()`);
        }
      }
    }
    checks.push({ name: 'upstream-hashes', value: manifest.files.length });
  } else {
    warnings.push('No --phaser-root supplied; skipped upstream hash and runtime factory validation.');
  }

  const result = {
    skillRoot,
    phaserRoot: options.phaserRoot ?? null,
    status: errors.length === 0 ? 'pass' : 'fail',
    summary: { errors: errors.length, warnings: warnings.length, checks },
    errors,
    warnings,
  };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.status.toUpperCase()}: ${errors.length} errors, ${warnings.length} warnings`);
    for (const error of errors) console.log(`  ERROR ${error}`);
    for (const warning of warnings) console.log(`  WARN ${warning}`);
  }
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
