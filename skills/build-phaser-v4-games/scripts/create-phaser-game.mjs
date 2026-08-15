#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { updateQualityTools } from './update-phaser-quality-tools.mjs';
import { parsePersistenceContract, validatePersistenceProofSummary } from '../assets/arcade-starter/scripts/persistence-proof.mjs';
import { assertProjectFingerprint, fingerprintProjectRelease, validateProjectFingerprint } from '../assets/arcade-starter/scripts/release-fingerprint.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.resolve(scriptDirectory, '..', 'assets');
const presetsFile = path.join(assetsRoot, 'presets.json');
const textExtensions = new Set(['.css', '.html', '.json', '.md', '.svg', '.ts']);

export function parseArguments(argv) {
  const options = {
    output: null,
    name: null,
    title: null,
    preset: null,
    idea: null,
    install: false,
    verify: false,
    dryRun: false,
    json: false,
    templateRoot: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--name') options.name = requiredValue(argv, ++index, argument);
    else if (argument === '--title') options.title = requiredValue(argv, ++index, argument);
    else if (argument === '--preset') options.preset = requiredValue(argv, ++index, argument);
    else if (argument === '--idea') options.idea = requiredValue(argv, ++index, argument);
    else if (argument === '--template-root') options.templateRoot = path.resolve(requiredValue(argv, ++index, argument));
    else if (argument === '--install') options.install = true;
    else if (argument === '--verify') options.verify = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--list-presets') options.listPresets = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else if (!options.output) options.output = path.resolve(argument);
    else throw new Error(`Unexpected argument: ${argument}`);
  }

  if (!options.help && !options.listPresets && !options.output && !options.idea) {
    throw new Error('Provide an output directory or --idea so one can be generated.');
  }
  return options;
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value.`);
  return value;
}

function usage() {
  return `Usage: node create-phaser-game.mjs [output-directory] --idea <description> [options]

Create a production-ready Phaser 4.2.1 TypeScript game from the bundled starter.
When output-directory is omitted, a stable project directory is generated in the current directory.

Options:
  --name <package-name>   Override the generated npm package name
  --title <game-title>   Override the generated human-facing title
  --preset <preset-id>   Explicit gameplay preset (overrides --idea)
  --idea <description>   Select one unambiguous preset from the game idea
  --list-presets         List available gameplay presets and exit
  --install              Run reproducible npm ci after generation
  --verify               Run tests, build, budgets, browser E2E, audit, and API checks
  --dry-run              Validate and report without writing files
  --json                 Print the final report as JSON
  -h, --help             Show this help`;
}

export async function loadPresetCatalog() {
  const catalog = JSON.parse(await readFile(presetsFile, 'utf8'));
  if (catalog.schemaVersion !== 2 || !Array.isArray(catalog.presets) || catalog.presets.length < 1) {
    throw new Error('The bundled preset catalog is invalid.');
  }
  const ids = new Set();
  const names = new Set();
  for (const preset of catalog.presets) {
    if (!/^[a-z0-9-]+$/.test(preset.id) || names.has(preset.id)) throw new Error(`Invalid or duplicate preset: ${preset.id}`);
    ids.add(preset.id);
    names.add(preset.id);
    if (!preset.template || !preset.primaryVerb || !Array.isArray(preset.bestFor)
      || !Array.isArray(preset.selectionTerms) || preset.selectionTerms.length < 1) throw new Error(`Preset ${preset.id} is incomplete.`);
    for (const source of [preset.template, preset.overlay].filter(Boolean)) validateCatalogPath(source, `Preset ${preset.id} source`);
    for (const relative of preset.remove ?? []) validateCatalogPath(relative, `Preset ${preset.id} removal`);
    for (const alias of preset.aliases ?? []) {
      if (!/^[a-z0-9-]+$/.test(alias) || names.has(alias)) throw new Error(`Invalid or duplicate preset alias: ${alias}`);
      names.add(alias);
    }
  }
  if (!ids.has(catalog.defaultPreset)) throw new Error(`Unknown default preset: ${catalog.defaultPreset}`);
  validatePresetSelectionTerms(catalog);
  return catalog;
}

function validateCatalogPath(relative, label) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error(`${label} must be a relative path.`);
  const normalized = path.normalize(relative);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error(`${label} escapes its allowed root.`);
  return normalized;
}

function publicPreset(preset, isDefault) {
  return {
    id: preset.id,
    label: preset.label,
    primaryVerb: preset.primaryVerb,
    pressure: preset.pressure,
    bestFor: preset.bestFor,
    selectionTerms: preset.selectionTerms,
    aliases: preset.aliases ?? [],
    default: isDefault,
  };
}

export async function listPresets() {
  const catalog = await loadPresetCatalog();
  return catalog.presets.map((preset) => publicPreset(preset, preset.id === catalog.defaultPreset));
}

function normalizeIdea(value) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function validatePresetSelectionTerms(catalog) {
  const seen = new Set();
  for (const preset of catalog.presets ?? []) {
    if (!Array.isArray(preset.selectionTerms) || preset.selectionTerms.length < 1) {
      throw new Error(`Preset ${preset.id ?? '<missing>'} has no selection terms.`);
    }
    for (const term of preset.selectionTerms) {
      const normalized = typeof term === 'string' ? normalizeIdea(term) : '';
      if (!normalized || normalized.length > 64 || seen.has(normalized)) {
        throw new Error(`Invalid or duplicate preset selection term: ${String(term)}.`);
      }
      seen.add(normalized);
    }
  }
  return catalog;
}

function matchesSelectionTerm(idea, term) {
  const normalized = normalizeIdea(term);
  if (!normalized) return false;
  if (/^[a-z0-9 ]+$/.test(normalized)) return (` ${idea} `).includes(` ${normalized} `);
  return idea.includes(normalized);
}

export function selectPresetFromIdea(catalog, value) {
  validatePresetSelectionTerms(catalog);
  if (typeof value !== 'string' || !value.trim()) throw new Error('--idea requires a non-empty game description.');
  if (value.length > 1_000) throw new Error('--idea must contain at most 1000 characters.');
  const idea = normalizeIdea(value);
  const candidates = catalog.presets.map((preset) => {
    const matchedTerms = [...new Set(preset.selectionTerms.filter((term) => matchesSelectionTerm(idea, term)))];
    return { preset, matchedTerms, score: matchedTerms.length };
  }).filter(({ score }) => score > 0).toSorted((left, right) => right.score - left.score || left.preset.id.localeCompare(right.preset.id));
  if (candidates.length === 0) {
    throw new Error(`The game idea does not unambiguously match a bundled preset. Use --preset with one of: ${catalog.presets.map(({ id }) => id).join(', ')}.`);
  }
  const winners = candidates.filter(({ score }) => score === candidates[0].score);
  if (winners.length !== 1) {
    throw new Error(`The game idea is ambiguous between ${winners.map(({ preset }) => preset.id).join(', ')}. Use --preset explicitly.`);
  }
  return { preset: winners[0].preset, matchedTerms: winners[0].matchedTerms, score: winners[0].score };
}

async function resolvePreset(rawOptions) {
  const catalog = await loadPresetCatalog();
  if (rawOptions.templateRoot) {
    return {
      id: rawOptions.preset ?? 'custom',
      sources: [path.resolve(rawOptions.templateRoot)],
      remove: [],
      metadata: null,
      selection: { method: 'template-root', matchedTerms: [], score: null },
    };
  }
  let preset;
  let selection;
  if (rawOptions.preset) {
    const normalized = rawOptions.preset.toLowerCase();
    preset = catalog.presets.find((candidate) => candidate.id === normalized || candidate.aliases?.includes(normalized));
    if (!preset) throw new Error(`Unknown preset "${rawOptions.preset}". Available presets: ${catalog.presets.map((candidate) => candidate.id).join(', ')}.`);
    selection = { method: 'explicit', matchedTerms: [], score: null };
  } else if (rawOptions.idea) {
    const inferred = selectPresetFromIdea(catalog, rawOptions.idea);
    preset = inferred.preset;
    selection = { method: 'idea', matchedTerms: inferred.matchedTerms, score: inferred.score };
  } else {
    preset = catalog.presets.find(({ id }) => id === catalog.defaultPreset);
    selection = { method: 'default', matchedTerms: [], score: null };
  }
  return {
    id: preset.id,
    sources: [preset.template, preset.overlay].filter(Boolean).map((source) => path.resolve(assetsRoot, validateCatalogPath(source, `Preset ${preset.id} source`))),
    remove: preset.remove ?? [],
    metadata: publicPreset(preset, preset.id === catalog.defaultPreset),
    selection,
  };
}

function packageName(value) {
  const result = packageSlug(value);
  if (!result) throw new Error('The project name must contain at least one ASCII letter or digit.');
  if (isReservedProjectName(result)) throw new Error(`The project name is reserved: ${result}.`);
  return result;
}

function packageSlug(value) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function isReservedProjectName(value) {
  return /^(?:node_modules|favicon\.ico|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
}

function displayTitle(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function ideaTitle(value, selectedPreset) {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const firstFragment = normalized.split(/[:：,，;；.!！?？\r\n]/u, 1)[0]
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/gu, '')
    .replace(/^(?:please\s+)?(?:build|create|make|develop|design)\s+(?:me\s+)?(?:an?\s+|the\s+)?/i, '')
    .replace(/^(?:请|请帮我|帮我)?(?:做|制作|创建|开发|设计)(?:一个|一款)?/u, '')
    .trim();
  const fallback = selectedPreset.metadata?.label ?? displayTitle(selectedPreset.id);
  const candidate = Array.from(firstFragment || fallback).slice(0, 80).join('').trim();
  const [first = '', ...rest] = Array.from(candidate);
  const title = first ? `${first.toLocaleUpperCase()}${rest.join('')}` : '';
  if (!title) throw new Error('The game title must contain 1 to 80 characters.');
  return title;
}

function stableIdeaHash(value) {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 10);
}

export function resolveProjectIdentity(rawOptions, selectedPreset, cwd = process.cwd()) {
  if (!rawOptions.output && !rawOptions.idea) {
    throw new Error('Provide an output directory or --idea so one can be generated.');
  }

  const explicitOutput = typeof rawOptions.output === 'string' && rawOptions.output.trim().length > 0;
  const explicitName = typeof rawOptions.name === 'string';
  const explicitTitle = typeof rawOptions.title === 'string';
  const resolvedCwd = path.resolve(cwd);
  const outputFromOptions = explicitOutput ? path.resolve(resolvedCwd, rawOptions.output) : null;

  let name;
  let nameSource;
  if (explicitName) {
    name = packageName(rawOptions.name);
    nameSource = 'explicit';
  } else if (outputFromOptions) {
    name = packageName(path.basename(outputFromOptions));
    nameSource = 'output-directory';
  } else {
    const slug = packageSlug(ideaTitle(rawOptions.idea, selectedPreset));
    const hash = stableIdeaHash(rawOptions.idea);
    const readable = slug.slice(0, 53).replace(/-+$/g, '');
    name = packageName(readable ? `${readable}-${hash}` : `${selectedPreset.id}-${hash}`);
    nameSource = slug ? 'idea-slug' : 'idea-hash';
  }

  const output = outputFromOptions ?? path.resolve(resolvedCwd, name);
  if (!outputFromOptions && path.dirname(output) !== resolvedCwd) {
    throw new Error('The generated output directory must be a direct child of the current directory.');
  }

  const title = explicitTitle
    ? rawOptions.title.trim()
    : !explicitOutput && rawOptions.idea
      ? ideaTitle(rawOptions.idea, selectedPreset)
      : displayTitle(name);
  if (!title || Array.from(title).length > 80) throw new Error('The game title must contain 1 to 80 characters.');

  return {
    output,
    name,
    title,
    sources: {
      output: explicitOutput ? 'explicit' : 'project-name',
      name: nameSource,
      title: explicitTitle ? 'explicit' : !explicitOutput && rawOptions.idea ? 'idea' : 'project-name',
    },
  };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function exists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

async function hasInstalledDependencies(root) {
  return (await exists(path.join(root, 'node_modules', 'phaser', 'package.json')))
    && (await exists(path.join(root, 'node_modules', 'typescript', 'package.json')))
    && (await exists(path.join(root, 'node_modules', 'vite', 'package.json')));
}

async function ensureTargetIsSafe(target) {
  if (!(await exists(target))) {
    await access(path.dirname(target));
    return { existed: false };
  }
  const targetStat = await stat(target);
  if (!targetStat.isDirectory()) throw new Error(`Target exists and is not a directory: ${target}`);
  const children = await readdir(target);
  if (children.length > 0) throw new Error(`Target directory must be empty: ${target}`);
  return { existed: true };
}

const transientDirectories = new Set(['node_modules', 'dist', '.quality']);

function shouldCopyTemplatePath(source, candidate) {
  const relative = path.relative(source, candidate);
  return relative === '' || !relative.split(path.sep).some((segment) => transientDirectories.has(segment));
}

async function collectFiles(root, current = root, output = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!transientDirectories.has(entry.name)) await collectFiles(root, absolute, output);
    }
    else output.push(path.relative(root, absolute));
  }
  return output;
}

async function replaceTokens(root, replacements) {
  const files = await collectFiles(root);
  for (const relative of files) {
    if (!textExtensions.has(path.extname(relative))) continue;
    const absolute = path.join(root, relative);
    let content = await readFile(absolute, 'utf8');
    for (const [token, value] of Object.entries(replacements)) content = content.replaceAll(token, value);
    await writeFile(absolute, content, 'utf8');
  }
  return files;
}

export function resolveSpawnCommand(command, args, platform = process.platform) {
  const executable = platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) {
    return {
      executable: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', executable, ...args],
    };
  }
  return { executable, args };
}

function run(command, args, cwd, quiet = false) {
  return new Promise((resolve, reject) => {
    const resolved = resolveSpawnCommand(command, args);
    const child = spawn(resolved.executable, resolved.args, { cwd, stdio: quiet ? 'pipe' : 'inherit', windowsHide: true });
    const output = [];
    if (quiet) {
      child.stdout.on('data', (chunk) => output.push(chunk));
      child.stderr.on('data', (chunk) => output.push(chunk));
    }
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else {
        const details = quiet ? Buffer.concat(output).toString('utf8').trim() : '';
        reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}.${details ? `\n${details}` : ''}`));
      }
    });
  });
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function matchesPublishedProject(staging, output, expectedName) {
  if (await exists(staging)) return false;
  const outputStat = await stat(output).catch(() => null);
  if (!outputStat?.isDirectory()) return false;
  try {
    const packageJson = JSON.parse(await readFile(path.join(output, 'package.json'), 'utf8'));
    return packageJson.name === expectedName;
  } catch {
    return false;
  }
}

export async function publishStagingDirectory(staging, output, expectedName, operations = {}) {
  const renameDirectory = operations.renameDirectory ?? rename;
  const pause = operations.pause ?? wait;
  const transientCodes = new Set(['EACCES', 'EBUSY', 'EPERM']);
  const maximumAttempts = 5;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await renameDirectory(staging, output);
      return { attempts: attempt, confirmedAfterError: false };
    } catch (error) {
      if (await matchesPublishedProject(staging, output, expectedName)) {
        return { attempts: attempt, confirmedAfterError: true };
      }
      if (!transientCodes.has(error?.code) || attempt === maximumAttempts || await exists(output)) throw error;
      await pause(40 * 2 ** (attempt - 1));
    }
  }
  throw new Error('Atomic project publication exhausted its retry budget.');
}

export async function readQualityEvidence(output) {
  const qualityRoot = path.join(output, '.quality');
  const [quality, bundle, browser, audit, api] = await Promise.all([
    readFile(path.join(output, 'game-quality.json'), 'utf8').then(JSON.parse),
    readFile(path.join(qualityRoot, 'bundle-budget.json'), 'utf8').then(JSON.parse),
    readFile(path.join(qualityRoot, 'browser-e2e.json'), 'utf8').then(JSON.parse),
    readFile(path.join(qualityRoot, 'phaser-audit.json'), 'utf8').then(JSON.parse),
    readFile(path.join(qualityRoot, 'phaser-api.json'), 'utf8').then(JSON.parse),
  ]);
  if (bundle.status !== 'pass' || !Array.isArray(bundle.failures) || bundle.failures.length !== 0) {
    throw new Error('Bundle budget evidence is not release-clean.');
  }
  const bundleFingerprints = validateProjectFingerprint(bundle.fingerprints, 'Bundle budget fingerprints');
  const browserFingerprints = validateProjectFingerprint(browser.fingerprints, 'Browser E2E fingerprints');
  const auditFingerprints = validateProjectFingerprint(audit.fingerprints, 'Phaser audit fingerprints');
  const apiFingerprints = validateProjectFingerprint(api.fingerprints, 'Phaser API fingerprints');
  assertProjectFingerprint(bundleFingerprints, browserFingerprints, 'Bundle/browser freshness');
  assertProjectFingerprint(bundleFingerprints, auditFingerprints, 'Bundle/audit freshness');
  assertProjectFingerprint(bundleFingerprints, apiFingerprints, 'Bundle/API freshness');
  const currentFingerprints = await fingerprintProjectRelease(output);
  assertProjectFingerprint(bundleFingerprints, currentFingerprints, 'Generator release freshness');
  const summary = browser.summary;
  if (!isStandardBrowserSummary(summary, quality.persistence)) {
    throw new Error('Browser E2E did not emit the standard preset summary.');
  }
  if (!matchesGameplayContract(quality.gameplay, summary.gameplay)) {
    throw new Error('Browser E2E gameplay does not match game-quality.json.');
  }
  if (audit.summary?.error !== 0 || audit.summary?.warning !== 0) {
    throw new Error('Phaser audit evidence is not release-clean.');
  }
  if (api.summary?.fail !== 0 || !(api.summary?.pass > 0)) {
    throw new Error('Phaser API evidence is not release-clean.');
  }
  return {
    typecheck: 'pass',
    tests: 'pass',
    build: 'pass',
    fingerprints: currentFingerprints,
    bundle: {
      status: bundle.status,
      entryBytes: bundle.summary.largestEntry?.bytes ?? null,
      entryGzipBytes: bundle.summary.largestEntry?.gzipBytes ?? null,
      totalBytes: bundle.summary.totalBytes,
      totalGzipBytes: bundle.summary.totalGzipBytes,
    },
    browser: {
      ...summary,
    },
    audit: { status: 'pass', ...audit.summary },
    api: { status: 'pass', ...api.summary },
    artifacts: [
      '.quality/bundle-budget.json',
      '.quality/browser-e2e.json',
      '.quality/browser-desktop.png',
      '.quality/browser-mobile.png',
      '.quality/phaser-audit.json',
      '.quality/phaser-api.json',
    ],
  };
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

const auxiliaryCheckpointNames = [
  'desktopInitial', 'failureTerminal', 'failureRestart', 'successTerminal',
  'successRestart', 'mobileInitial', 'mobileProgress'
];

function isAuxiliaryTimeline(auxiliary, expectedName) {
  const checkpoints = auxiliary?.checkpoints;
  return auxiliary?.name === expectedName
    && isFiniteNumber(auxiliary?.value)
    && checkpoints && typeof checkpoints === 'object' && !Array.isArray(checkpoints)
    && Object.keys(checkpoints).length === auxiliaryCheckpointNames.length
    && auxiliaryCheckpointNames.every((name) => {
      const checkpoint = checkpoints[name];
      return checkpoint?.name === expectedName
        && isFiniteNumber(checkpoint?.value)
        && isFiniteNumber(checkpoint?.visibleValue)
        && checkpoint.visibleValue === checkpoint.value;
    })
    && checkpoints.desktopInitial.value === auxiliary.value;
}

function matchesGameplayContract(contract, gameplay) {
  const auxiliaryName = contract?.auxiliaryName ?? 'remaining-seconds';
  return contract && typeof contract === 'object' && !Array.isArray(contract)
    && typeof contract.primaryAction === 'string' && contract.primaryAction.length > 0
    && typeof contract.progressName === 'string' && contract.progressName.length > 0
    && isFiniteNumber(contract.completionTarget) && contract.completionTarget > 0
    && typeof auxiliaryName === 'string' && auxiliaryName.length > 0
    && typeof contract.pressureName === 'string' && contract.pressureName.length > 0
    && isFiniteNumber(contract.maximumPressure) && contract.maximumPressure > 0
    && typeof contract.successReason === 'string' && contract.successReason.length > 0
    && typeof contract.failureReason === 'string' && contract.failureReason.length > 0
    && gameplay?.primaryAction === contract.primaryAction
    && gameplay?.progress?.name === contract.progressName
    && gameplay?.progress?.target === contract.completionTarget
    && isAuxiliaryTimeline(gameplay?.auxiliary, auxiliaryName)
    && gameplay?.failure?.pressure?.name === contract.pressureName
    && gameplay?.failure?.pressure?.before === contract.maximumPressure
    && gameplay?.success?.terminalReason === contract.successReason
    && gameplay?.failure?.terminalReason === contract.failureReason;
}

function isViewport(value) {
  return isFiniteNumber(value?.width) && value.width > 0 && isFiniteNumber(value?.height) && value.height > 0;
}

function isInputPlanSummary(value) {
  const allowed = /^(?:pointer:(?:click|hold|drag)|navigate:directional|key:(?:pulse|hold))$/;
  return value?.schemaVersion === 1
    && Array.isArray(value.primary) && value.primary.length > 0 && value.primary.every((action) => allowed.test(action))
    && Array.isArray(value.pressure) && value.pressure.length > 0 && value.pressure.every((action) => allowed.test(action));
}

function isExecutedInputList(value, allowed) {
  return Array.isArray(value) && value.length > 0
    && value.every((action) => typeof action === 'string' && allowed.test(action));
}

function executedInputsAreDeclared(executed, device, declared) {
  return Array.isArray(executed) && Array.isArray(declared)
    && executed.every((action) => declared.includes(action.slice(device.length + 1)));
}

function coversDeclaredInputs(executed, device, declared, predicate) {
  if (!Array.isArray(executed) || !Array.isArray(declared)) return false;
  const expected = [...new Set(declared.filter(predicate).map((action) => `${device}:${action}`))];
  return expected.length === 0 || expected.every((action) => executed.includes(action));
}

const terminalSnapshotFields = [
  'phase', 'run', 'progress', 'pressure', 'playerPosition', 'terminalKind',
  'terminalReason', 'auxiliaryName', 'auxiliaryValue', 'auxiliaryVisibleValue',
  'acceptedInputs'
];

function primaryInputKeys(declaredPrimary) {
  return Array.isArray(declaredPrimary) ? [...new Set(declaredPrimary)].sort() : null;
}

function isAcceptedInputCounters(value, declaredPrimary) {
  const expected = primaryInputKeys(declaredPrimary);
  if (!expected || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && expected.every((key, index) => actual[index] === key && Number.isInteger(value[key]) && value[key] >= 0);
}

function sameAcceptedInputCounters(before, after, declaredPrimary) {
  return isAcceptedInputCounters(before, declaredPrimary)
    && isAcceptedInputCounters(after, declaredPrimary)
    && primaryInputKeys(declaredPrimary).every((key) => after[key] === before[key]);
}

function isPrimaryInputAcceptance(evidence, declaredPrimary, requiredPrimary = declaredPrimary) {
  const declared = primaryInputKeys(declaredPrimary);
  const required = primaryInputKeys(requiredPrimary);
  return declared && required
    && required.every((key) => declared.includes(key))
    && Array.isArray(evidence?.actions)
    && evidence.actions.length === required.length
    && required.every((key) => evidence.actions.includes(key))
    && isAcceptedInputCounters(evidence.before, declared)
    && isAcceptedInputCounters(evidence.after, declared)
    && required.every((key) => evidence.after[key] > evidence.before[key]);
}

function isTerminalSnapshot(snapshot, terminalKind, declaredPrimary) {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    && Object.keys(snapshot).length === terminalSnapshotFields.length
    && terminalSnapshotFields.every((field) => Object.hasOwn(snapshot, field))
    && snapshot.phase === 'game-over'
    && Number.isInteger(snapshot.run) && snapshot.run > 0
    && isFiniteNumber(snapshot.progress) && snapshot.progress >= 0
    && isFiniteNumber(snapshot.pressure) && snapshot.pressure >= 0
    && typeof snapshot.playerPosition === 'string' && /^-?\d+,-?\d+$/.test(snapshot.playerPosition)
    && snapshot.terminalKind === terminalKind
    && typeof snapshot.terminalReason === 'string' && snapshot.terminalReason.length > 0
    && typeof snapshot.auxiliaryName === 'string' && snapshot.auxiliaryName.length > 0
    && isFiniteNumber(snapshot.auxiliaryValue)
    && snapshot.auxiliaryVisibleValue === snapshot.auxiliaryValue
    && isAcceptedInputCounters(snapshot.acceptedInputs, declaredPrimary);
}

function isTerminalInputLock(inputLock, terminalKind, declaredPrimary) {
  if (!Array.isArray(declaredPrimary)) return false;
  const expected = [...new Set(declaredPrimary.map((action) => action.startsWith('pointer:') ? `mouse:${action}` : `keyboard:${action}`))];
  return inputLock?.terminalKind === terminalKind
    && Array.isArray(inputLock.actions)
    && inputLock.actions.length === expected.length
    && expected.every((action) => inputLock.actions.includes(action))
    && isTerminalSnapshot(inputLock.before, terminalKind, declaredPrimary)
    && isTerminalSnapshot(inputLock.after, terminalKind, declaredPrimary)
    && sameAcceptedInputCounters(inputLock.before.acceptedInputs, inputLock.after.acceptedInputs, declaredPrimary)
    && JSON.stringify(inputLock.after) === JSON.stringify(inputLock.before);
}

const pauseSnapshotFields = [...terminalSnapshotFields, 'pauseLabel', 'pausePressed'];

function isPauseSnapshot(snapshot, declaredPrimary) {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    && Object.keys(snapshot).length === pauseSnapshotFields.length
    && pauseSnapshotFields.every((field) => Object.hasOwn(snapshot, field))
    && snapshot.phase === 'paused'
    && Number.isInteger(snapshot.run) && snapshot.run > 0
    && isFiniteNumber(snapshot.progress) && snapshot.progress >= 0
    && isFiniteNumber(snapshot.pressure) && snapshot.pressure > 0
    && typeof snapshot.playerPosition === 'string' && /^-?\d+,-?\d+$/.test(snapshot.playerPosition)
    && !snapshot.terminalKind && !snapshot.terminalReason
    && typeof snapshot.auxiliaryName === 'string' && snapshot.auxiliaryName.length > 0
    && isFiniteNumber(snapshot.auxiliaryValue)
    && snapshot.auxiliaryVisibleValue === snapshot.auxiliaryValue
    && isAcceptedInputCounters(snapshot.acceptedInputs, declaredPrimary)
    && snapshot.pauseLabel === 'Resume'
    && snapshot.pausePressed === 'true';
}

function isPauseFreeze(pauseFreeze, declaredPrimary) {
  if (!Array.isArray(declaredPrimary)) return false;
  const expected = [...new Set(declaredPrimary.map((action) => action.startsWith('pointer:') ? `mouse:${action}` : `keyboard:${action}`))];
  return Array.isArray(pauseFreeze?.actions)
    && pauseFreeze.actions.length === expected.length
    && expected.every((action) => pauseFreeze.actions.includes(action))
    && Number.isInteger(pauseFreeze.observedMs) && pauseFreeze.observedMs >= 1_000
    && isPauseSnapshot(pauseFreeze.before, declaredPrimary)
    && isPauseSnapshot(pauseFreeze.after, declaredPrimary)
    && JSON.stringify(pauseFreeze.after) === JSON.stringify(pauseFreeze.before)
    && Number.isInteger(pauseFreeze.resumed?.observedMs) && pauseFreeze.resumed.observedMs >= 250
    && isResumedSnapshot(pauseFreeze.resumed.before, declaredPrimary)
    && isResumedSnapshot(pauseFreeze.resumed.after, declaredPrimary)
    && pauseFreeze.resumed.after.run === pauseFreeze.resumed.before.run
    && pauseFreeze.resumed.after.auxiliaryName === pauseFreeze.resumed.before.auxiliaryName
    && sameAcceptedInputCounters(pauseFreeze.resumed.before.acceptedInputs, pauseFreeze.resumed.after.acceptedInputs, declaredPrimary);
}

function isResumedSnapshot(snapshot, declaredPrimary) {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    && Object.keys(snapshot).length === pauseSnapshotFields.length
    && pauseSnapshotFields.every((field) => Object.hasOwn(snapshot, field))
    && snapshot.phase === 'playing'
    && Number.isInteger(snapshot.run) && snapshot.run > 0
    && isFiniteNumber(snapshot.progress) && snapshot.progress >= 0
    && isFiniteNumber(snapshot.pressure) && snapshot.pressure > 0
    && typeof snapshot.playerPosition === 'string' && /^-?\d+,-?\d+$/.test(snapshot.playerPosition)
    && !snapshot.terminalKind && !snapshot.terminalReason
    && typeof snapshot.auxiliaryName === 'string' && snapshot.auxiliaryName.length > 0
    && isFiniteNumber(snapshot.auxiliaryValue)
    && snapshot.auxiliaryVisibleValue === snapshot.auxiliaryValue
    && isAcceptedInputCounters(snapshot.acceptedInputs, declaredPrimary)
    && snapshot.pauseLabel === 'Pause'
    && snapshot.pausePressed === 'false';
}

function isPersistenceContract(contract) {
  try {
    parsePersistenceContract(contract);
    return true;
  } catch {
    return false;
  }
}

function isPersistenceSummary(persistence, contract, progress) {
  try {
    return validatePersistenceProofSummary(persistence, contract, progress);
  } catch {
    return false;
  }
}

function isStandardBrowserSummary(summary, persistenceContract) {
  const gameplay = summary?.gameplay;
  const progress = gameplay?.progress;
  const success = gameplay?.success;
  const failure = gameplay?.failure;
  const pressure = failure?.pressure;
  const successRestart = success?.restart;
  const failureRestart = failure?.restart;
  const errors = summary?.errors;
  const interactions = summary?.interactions;
  const mobilePointer = interactions?.mobilePointer;
  const persistence = summary?.persistence;
  const migration = persistence?.migration;
  const reload = persistence?.reload;
  const persistenceProgress = { success: progress?.after, failure: failure?.progress };
  return summary?.status === 'pass'
    && isViewport(summary.viewports?.desktop)
    && isViewport(summary.viewports?.mobile)
    && isExecutedInputList(interactions?.desktopPointer, /^mouse:pointer:(?:click|hold|drag)$/)
    && executedInputsAreDeclared(interactions.desktopPointer, 'mouse', gameplay?.inputPlan?.primary)
    && coversDeclaredInputs(interactions.desktopPointer, 'mouse', gameplay?.inputPlan?.primary, (action) => action.startsWith('pointer:'))
    && isExecutedInputList(interactions?.desktopKeyboard, /^keyboard:(?:navigate:directional|key:(?:pulse|hold))$/)
    && executedInputsAreDeclared(
      interactions.desktopKeyboard,
      'keyboard',
      [...(gameplay?.inputPlan?.primary ?? []), ...(gameplay?.inputPlan?.pressure ?? [])]
    )
    && coversDeclaredInputs(
      interactions.desktopPrimaryKeyboard,
      'keyboard',
      gameplay?.inputPlan?.primary,
      (action) => action.startsWith('navigate:') || action.startsWith('key:')
    )
    && isExecutedInputList(mobilePointer?.actions, /^touch:pointer:(?:click|hold|drag)$/)
    && executedInputsAreDeclared(mobilePointer.actions, 'touch', gameplay?.inputPlan?.primary)
    && coversDeclaredInputs(mobilePointer.actions, 'touch', gameplay?.inputPlan?.primary, (action) => action.startsWith('pointer:'))
    && mobilePointer.progressName === progress.name
    && mobilePointer.before === progress.before
    && isFiniteNumber(mobilePointer.after) && mobilePointer.after > mobilePointer.before && mobilePointer.after <= progress.target
    && isPrimaryInputAcceptance(
      mobilePointer.inputAcceptance,
      gameplay.inputPlan.primary,
      gameplay.inputPlan.primary.filter((action) => action.startsWith('pointer:'))
    )
    && typeof gameplay?.primaryAction === 'string' && gameplay.primaryAction.length > 0
    && isInputPlanSummary(gameplay.inputPlan)
    && isPrimaryInputAcceptance(gameplay.inputAcceptance, gameplay.inputPlan.primary)
    && isPauseFreeze(gameplay.pauseFreeze, gameplay.inputPlan.primary)
    && typeof progress?.name === 'string' && progress.name.length > 0
    && isFiniteNumber(progress.before) && isFiniteNumber(progress.after) && progress.after > progress.before
    && isFiniteNumber(progress.target) && progress.target > progress.before && progress.after >= progress.target
    && success?.terminalState === 'game-over'
    && success.terminalKind === 'success'
    && typeof success.terminalReason === 'string' && success.terminalReason.length > 0
    && isTerminalInputLock(success.inputLock, 'success', gameplay.inputPlan.primary)
    && successRestart?.progress === 0 && isFiniteNumber(successRestart.pressure) && successRestart.pressure > 0
    && isFiniteNumber(successRestart.playableProgress) && successRestart.playableProgress > 0
    && Number.isInteger(successRestart.run) && successRestart.run >= 4
    && Number.isInteger(successRestart.cleanupRun) && successRestart.cleanupRun > successRestart.run
    && typeof pressure?.name === 'string' && pressure.name.length > 0
    && isFiniteNumber(pressure.before) && pressure.before > 0
    && pressure.after === 0 && Number.isInteger(pressure.events) && pressure.events > 0
    && isFiniteNumber(failure?.progress) && failure.progress >= 0
    && failure?.terminalState === 'game-over'
    && failure.terminalKind === 'failure'
    && typeof failure.terminalReason === 'string' && failure.terminalReason.length > 0
    && isTerminalInputLock(failure.inputLock, 'failure', gameplay.inputPlan.primary)
    && failureRestart?.progress === 0 && isFiniteNumber(failureRestart.pressure) && failureRestart.pressure > 0
    && isFiniteNumber(failureRestart.playableProgress) && failureRestart.playableProgress > 0
    && Number.isInteger(failureRestart.run) && failureRestart.run >= 2
    && Number.isInteger(failureRestart.cleanupRun) && failureRestart.cleanupRun > failureRestart.run
    && successRestart.run > failureRestart.cleanupRun
    && isPersistenceContract(persistenceContract)
    && isPersistenceSummary(persistence, persistenceContract, persistenceProgress)
    && migration?.status === 'pass' && migration.fromVersion === persistenceContract.migrationFromVersion && migration.toVersion === persistenceContract.schemaVersion && migration.loadStatus === 'migrated'
    && typeof migration.muted === 'boolean' && migration.audioMuted === migration.muted
    && Number.isInteger(migration.settingsInteractions) && migration.settingsInteractions >= 1
    && reload?.status === 'pass' && reload.schemaVersion === persistenceContract.schemaVersion && reload.loadStatus === 'current'
    && typeof reload.muted === 'boolean' && reload.audioMuted === reload.muted
    && Number.isInteger(reload.settingsInteractions) && reload.settingsInteractions >= 1
    && errors?.consoleMessages === 0 && errors?.exceptions === 0 && errors?.failedResponses === 0;
}

export async function createGame(rawOptions) {
  const selectedPreset = await resolvePreset(rawOptions);
  const identity = resolveProjectIdentity(rawOptions, selectedPreset, rawOptions.cwd);
  const { output, name, title } = identity;
  const targetState = await ensureTargetIsSafe(output);
  for (const source of selectedPreset.sources) {
    if (!(await exists(source))) throw new Error(`Starter template is missing: ${source}`);
  }

  const sourceFiles = new Set();
  for (const source of selectedPreset.sources) {
    for (const relative of await collectFiles(source)) sourceFiles.add(relative);
  }
  for (const relative of selectedPreset.remove) sourceFiles.delete(relative);
  const report = {
    output,
    name,
    title,
    projectIdentity: {
      schemaVersion: 1,
      name,
      title,
      sources: identity.sources,
    },
    preset: selectedPreset.id,
    presetMetadata: selectedPreset.metadata,
    presetSelection: selectedPreset.selection,
    template: selectedPreset.sources.map((source) => path.basename(source)).join('+'),
    fileCount: sourceFiles.size + 1,
    installed: false,
    verified: false,
    quality: null,
    dryRun: rawOptions.dryRun,
  };
  if (rawOptions.dryRun) return report;

  const staging = path.join(path.dirname(output), `.${path.basename(output)}.phaser-stage-${process.pid}-${Date.now()}`);
  let targetRemoved = false;
  await mkdir(staging, { recursive: false });
  try {
    await cp(selectedPreset.sources[0], staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (candidate) => shouldCopyTemplatePath(selectedPreset.sources[0], candidate),
    });
    for (const overlay of selectedPreset.sources.slice(1)) {
      await cp(overlay, staging, {
        recursive: true,
        force: true,
        filter: (candidate) => shouldCopyTemplatePath(overlay, candidate),
      });
    }
    for (const transient of transientDirectories) {
      await rm(path.join(staging, transient), { recursive: true, force: true });
    }
    for (const relative of selectedPreset.remove) {
      const removal = path.resolve(staging, validateCatalogPath(relative, `Preset ${selectedPreset.id} removal`));
      const fromStaging = path.relative(staging, removal);
      if (fromStaging.startsWith('..') || path.isAbsolute(fromStaging)) throw new Error(`Preset ${selectedPreset.id} removal escapes staging: ${relative}`);
      await rm(removal, { force: true });
    }
    await replaceTokens(staging, {
      '__PACKAGE_NAME__': name,
      '__GAME_TITLE_HTML__': escapeHtml(title),
      '__GAME_TITLE_JSON__': JSON.stringify(title),
    });
    await writeFile(path.join(staging, 'game-preset.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: selectedPreset.id,
      selection: selectedPreset.selection,
      projectIdentity: report.projectIdentity,
      ...(selectedPreset.metadata ?? {}),
    }, null, 2)}\n`, 'utf8');
    if (rawOptions.install) {
      await run('npm', ['ci', '--no-audit', '--no-fund'], staging, rawOptions.json);
      report.installed = true;
    }
    if (rawOptions.verify) {
      if (!rawOptions.install && !(await hasInstalledDependencies(staging))) {
        throw new Error('Verification requires installed dependencies. Add --install or run npm install first.');
      }
      const qualityTools = await updateQualityTools({ projectRoot: staging });
      if (qualityTools.status !== 'current') {
        throw new Error(`Verification requires current managed quality tools, found ${qualityTools.status}.`);
      }
      await run('npm', ['run', 'check'], staging, rawOptions.json);
      report.quality = await readQualityEvidence(staging);
      report.verified = true;
    }
    if (targetState.existed) {
      await rm(output, { recursive: false });
      targetRemoved = true;
    }
    await publishStagingDirectory(staging, output, name);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (targetState.existed && targetRemoved && !(await exists(output))) await mkdir(output).catch(() => undefined);
    throw error;
  }
  return report;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.listPresets) {
    const presets = await listPresets();
    if (options.json) console.log(JSON.stringify({ defaultPreset: presets.find((preset) => preset.default)?.id, presets }, null, 2));
    else for (const preset of presets) console.log(`${preset.id}${preset.default ? ' (default)' : ''}: ${preset.label} - ${preset.primaryVerb}; ${preset.pressure}`);
    return;
  }
  const report = await createGame(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    const action = report.dryRun ? 'Would create' : 'Created';
    console.log(`${action} ${report.title} at ${report.output} (${report.fileCount} files).`);
    if (!report.dryRun) console.log(`Next: cd ${JSON.stringify(report.output)} && npm run dev`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
