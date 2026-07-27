#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultAnchorsFile = path.join(skillRoot, 'references', 'api-anchors.json');

function parseArguments(argv) {
  const options = { root: null, anchors: defaultAnchorsFile, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--anchors') {
      index += 1;
      if (!argv[index]) throw new Error('--anchors requires a file path');
      options.anchors = path.resolve(argv[index]);
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!options.root) options.root = path.resolve(arg);
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  options.root ??= process.cwd();
  return options;
}

function printHelp() {
  console.log(`Usage: node check-phaser-api.mjs [project-or-phaser-root] [options]

Validate curated Phaser 4 declarations and source ownership anchors.

Options:
  --anchors <file>  Use a custom anchor manifest
  --json            Print machine-readable JSON
  -h, --help        Show this help`);
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot parse ${file}: ${error.message}`);
  }
}

function versionParts(version) {
  const match = String(version ?? '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unsupported Phaser version string: ${version}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function appliesToVersion(item, version) {
  if (item.since && compareVersions(version, item.since) < 0) return false;
  if (item.until && compareVersions(version, item.until) > 0) return false;
  return true;
}

async function packageAt(directory) {
  const packageFile = path.join(directory, 'package.json');
  if (!(await exists(packageFile))) return null;
  const packageJson = await readJson(packageFile);
  return packageJson.name === 'phaser' ? { root: directory, packageFile, packageJson } : null;
}

export async function resolvePhaserRoot(input) {
  let current = path.resolve(input);
  if ((await exists(current)) && (await stat(current)).isFile()) current = path.dirname(current);

  while (true) {
    const direct = await packageAt(current);
    if (direct) return direct;

    const installed = await packageAt(path.join(current, 'node_modules', 'phaser'));
    if (installed) return installed;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Cannot resolve a Phaser package from ${path.resolve(input)}`);
}

function regex(pattern) {
  try {
    return new RegExp(pattern, 'm');
  } catch (error) {
    throw new Error(`Invalid anchor regex ${JSON.stringify(pattern)}: ${error.message}`);
  }
}

function scopedText(text, scopePattern) {
  const match = regex(scopePattern).exec(text);
  if (!match) return null;

  const matchedLineOffset = match[0].lastIndexOf('\n') + 1;
  const headerIndex = match.index + matchedLineOffset;
  const lineStart = text.lastIndexOf('\n', headerIndex - 1) + 1;
  const lineEnd = text.indexOf('\n', headerIndex);
  const header = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const indent = header.match(/^\s*/)?.[0] ?? '';
  const closing = new RegExp(`^${indent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'm');
  const remainderStart = lineEnd === -1 ? text.length : lineEnd + 1;
  const remainder = text.slice(remainderStart);
  const close = closing.exec(remainder);
  return close ? text.slice(lineStart, remainderStart + close.index + close[0].length) : text.slice(lineStart);
}

async function inspectPatterns(root, check, cache, absent = false) {
  const absolute = path.join(root, check.path);
  if (!(await exists(absolute))) return [`missing file ${check.path}`];
  let text = cache.get(absolute);
  if (text === undefined) {
    text = await readFile(absolute, 'utf8');
    cache.set(absolute, text);
  }

  if (check.scopePattern) {
    text = scopedText(text, check.scopePattern);
    if (text === null) return [`missing scope /${check.scopePattern}/ in ${check.path}`];
  }

  const patterns = absent ? (check.absentPatterns ?? []) : (check.memberPatterns ?? check.patterns ?? []);
  const problems = [];
  for (const pattern of patterns) {
    const present = regex(pattern).test(text);
    if (!absent && !present) problems.push(`missing /${pattern}/ in ${check.path}`);
    if (absent && present) problems.push(`unexpected /${pattern}/ in ${check.path}`);
  }
  return problems;
}

async function inspectItem(root, item, version, cache, kind) {
  if (!appliesToVersion(item, version)) {
    return { id: item.id, description: item.description, kind, status: 'skipped', problems: [] };
  }

  const problems = [];
  if (item.declaration) {
    problems.push(...await inspectPatterns(root, item.declaration, cache));
    if (item.declaration.absentPatterns) {
      problems.push(...await inspectPatterns(root, item.declaration, cache, true));
    }
  }
  for (const source of item.sources ?? []) {
    problems.push(...await inspectPatterns(root, source, cache));
  }

  return {
    id: item.id,
    description: item.description,
    kind,
    status: problems.length === 0 ? 'pass' : 'fail',
    problems,
  };
}

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported api-anchors schemaVersion');
  if (!Number.isInteger(manifest.targetMajor)) throw new Error('api-anchors targetMajor must be an integer');
  if (!Array.isArray(manifest.anchors) || manifest.anchors.length === 0) throw new Error('api-anchors needs anchors');
  const ids = new Set();
  for (const item of [...manifest.anchors, ...(manifest.knownDivergences ?? [])]) {
    if (!item.id || ids.has(item.id)) throw new Error(`Invalid or duplicate anchor id: ${item.id}`);
    ids.add(item.id);
  }
}

function inspectPackage(packageJson, manifest) {
  const problems = [];
  const expected = manifest.packageExpectations ?? {};
  if (expected.name && packageJson.name !== expected.name) problems.push(`package name is ${packageJson.name}`);
  if (expected.types && packageJson.types !== expected.types) problems.push(`package types is ${packageJson.types ?? '<missing>'}`);
  for (const key of expected.rootExports ?? []) {
    if (!packageJson.exports || !(key in packageJson.exports)) problems.push(`package export ${key} is missing`);
  }
  return problems;
}

export async function checkPhaserApi(input, anchorsFile = defaultAnchorsFile) {
  const manifest = await readJson(path.resolve(anchorsFile));
  validateManifest(manifest);
  const resolved = await resolvePhaserRoot(input);
  const version = resolved.packageJson.version;
  const major = versionParts(version)[0];
  if (major !== manifest.targetMajor) {
    throw new Error(`Detected Phaser ${version}; anchors target major ${manifest.targetMajor}`);
  }

  const cache = new Map();
  const results = [];
  for (const item of manifest.anchors) {
    results.push(await inspectItem(resolved.root, item, version, cache, 'anchor'));
  }
  for (const item of manifest.knownDivergences ?? []) {
    results.push(await inspectItem(resolved.root, item, version, cache, 'known-divergence'));
  }

  const packageProblems = inspectPackage(resolved.packageJson, manifest);
  const summary = results.reduce((output, item) => {
    output[item.status] += 1;
    return output;
  }, { pass: 0, fail: 0, skipped: 0 });
  if (packageProblems.length > 0) summary.fail += 1;

  return {
    phaserRoot: resolved.root,
    version,
    validatedBaseline: manifest.validatedVersion,
    packageProblems,
    summary,
    results,
  };
}

function printText(report) {
  console.log('Phaser API anchor check');
  console.log(`Root:      ${report.phaserRoot}`);
  console.log(`Version:   ${report.version} (skill baseline ${report.validatedBaseline})`);
  console.log(`Anchors:   ${report.summary.pass} passed, ${report.summary.fail} failed, ${report.summary.skipped} skipped`);

  for (const problem of report.packageProblems) console.log(`\n[FAIL] package: ${problem}`);
  for (const item of report.results) {
    if (item.status === 'pass' && item.kind === 'anchor') continue;
    const label = item.status === 'pass' ? 'CONFIRMED' : item.status.toUpperCase();
    console.log(`\n[${label}] ${item.id}${item.kind === 'known-divergence' ? ' (known divergence)' : ''}`);
    console.log(`  ${item.description}`);
    for (const problem of item.problems) console.log(`  ${problem}`);
  }
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    const report = await checkPhaserApi(options.root, options.anchors);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printText(report);
    if (report.summary.fail > 0) process.exitCode = 1;
  } catch (error) {
    if (options?.json) console.log(JSON.stringify({ error: error.message }, null, 2));
    else console.error(`API check failed: ${error.message}`);
    process.exitCode = 2;
  }
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) await main();
