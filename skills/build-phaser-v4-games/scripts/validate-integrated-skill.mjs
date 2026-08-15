#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePersistenceContract } from '../assets/arcade-starter/scripts/persistence-proof.mjs';

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

async function resolvePhaserRoot(candidate) {
  const directPackage = path.join(candidate, 'package.json');
  if (await exists(directPackage)) {
    const packageJson = JSON.parse(await readFile(directPackage, 'utf8'));
    if (packageJson.name === 'phaser' && await exists(path.join(candidate, 'src'))) return candidate;
  }
  const installed = path.join(candidate, 'node_modules', 'phaser');
  if (await exists(path.join(installed, 'package.json'))) return installed;
  throw new Error(`Cannot resolve Phaser from ${candidate}; pass a Phaser package root or a project with node_modules/phaser.`);
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
  const generatorSource = await readFile(path.join(skillRoot, 'scripts', 'create-phaser-game.mjs'), 'utf8');
  const requiredRoutes = [
    'references/official-topic-index.md',
    'references/official-corrections-4.2.1.md',
    'assets/presets.json',
    'scripts/create-phaser-game.mjs',
    'scripts/query-phaser-api.mjs',
    'scripts/validate-integrated-skill.mjs',
  ];
  for (const route of requiredRoutes) {
    if (!mainSkill.includes(route)) errors.push(`Root SKILL.md does not route ${route}`);
  }
  for (const token of ['--idea', 'selectPresetFromIdea', 'matchedTerms', "method: 'idea'", 'ambiguous between', 'does not unambiguously match']) {
    if (!generatorSource.includes(token)) errors.push(`Project generator lacks idea-selection contract token: ${token}`);
  }

  const assetsRoot = path.join(skillRoot, 'assets');
  const catalogFile = path.join(assetsRoot, 'presets.json');
  if (!(await exists(catalogFile))) throw new Error(`Missing ${catalogFile}`);
  const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
  if (catalog.schemaVersion !== 2) errors.push(`Preset catalog schema must be 2, found ${catalog.schemaVersion ?? 'missing'}.`);
  if (!Array.isArray(catalog.presets) || catalog.presets.length < 2) errors.push('Preset catalog must contain at least two gameplay presets.');

  const presetRequirements = [
    'package.json',
    'package-lock.json',
    'game-quality.json',
    'phaser-quality-tools.json',
    'index.html',
    'scripts/browser-e2e.mjs',
    'scripts/audit-phaser-project.mjs',
    'scripts/check-phaser-api.mjs',
    'scripts/api-anchors.json',
    'scripts/check-release.mjs',
    'scripts/check-release.test.mjs',
    'scripts/quality-input-driver.mjs',
    'scripts/quality-input-driver.test.mjs',
    'scripts/quality-input-plan.mjs',
    'scripts/quality-input-plan.test.mjs',
    'scripts/persistence-proof.mjs',
    'scripts/persistence-proof.test.mjs',
    'scripts/check-bundle-budget.mjs',
    'scripts/check-bundle-budget.test.mjs',
    'scripts/release-fingerprint.mjs',
    'scripts/release-fingerprint.test.mjs',
    'src/main.ts',
    'src/domain/run-model.ts',
    'src/domain/run-model.test.ts',
    'src/domain/accepted-input-counters.ts',
    'src/domain/accepted-input-counters.test.ts',
    'src/platform/player-profile.ts',
    'src/platform/player-profile.test.ts',
    'src/scenes/boot-scene.ts',
    'src/scenes/game-scene.ts',
    'src/scenes/hud-scene.ts',
  ];
  const qualityFields = [
    'qualityProgressName',
    'qualityProgress',
    'qualityCompletionTarget',
    'qualityAuxiliaryName',
    'qualityAuxiliaryValue',
    'qualityPressureName',
    'qualityPressure',
    'qualityMaximumPressure',
    'qualityPrimaryAction',
    'qualityInputPlan',
    'qualityAcceptedInputs',
    'qualityPrimaryTargets',
    'qualityPressureTargets',
    'qualityWorldWidth',
    'qualityWorldHeight',
    'qualityRestartPosition',
    'qualityTerminalKind',
    'qualityTerminalReason',
  ];
  const browserProofs = [
    'completePrimaryAction',
    'parseQualityInputPlan',
    'summarizeQualityInputPlan',
    'executeInputActions',
    "pointerDevice: 'touch'",
    'desktopKeyboard',
    'desktopPrimaryKeyboard',
    'desktopPointer',
    'assertAuxiliaryTimeline',
    'mobileProgress',
    'proveTerminalInputLock',
    'assertTerminalInputLockEvidence',
    'provePauseFreeze',
    'assertPauseFreezeEvidence',
    'assertAcceptedInputCounters',
    'assertPrimaryInputAcceptanceEvidence',
    'Primary input acceptance did not prove every declared primary input',
    'Primary input ${key} was dispatched but not accepted by gameplay',
    'Paused input leaked into resumed gameplay',
    'mobilePointer',
    'dispatchedKeyboardInput',
    'completeSuccessThroughGameplay',
    'exhaustPressureThroughGameplay',
    'assertTerminalPause',
    'successRestart',
    'failureRestart',
    'Restarted gameplay did not complete its declared primary action',
    'composited-canvas-screenshot',
    'minimumTouchTarget',
    'failedResponses',
    'viewports',
    'interactions',
    'gameplay',
    'assertGameplayContract',
    'browser-e2e.json',
    'runReleaseChecks',
    'errors',
    'verifyProfileMigration',
    'verifyProfileReload',
    'verifyPersistenceProofPhase',
    'Page.reload',
    'persistence',
  ];
  const ids = new Set();
  const names = new Set();
  const verbs = new Set();
  const selectionTerms = new Set();
  for (const preset of catalog.presets ?? []) {
    const prefix = `Preset ${preset.id ?? '<missing>'}`;
    if (!/^[a-z0-9-]+$/.test(preset.id ?? '') || names.has(preset.id)) errors.push(`${prefix} has an invalid or colliding id.`);
    ids.add(preset.id);
    names.add(preset.id);
    verbs.add(preset.primaryVerb);
    if (!preset.label || !preset.primaryVerb || !preset.pressure || !Array.isArray(preset.bestFor) || preset.bestFor.length < 1) {
      errors.push(`${prefix} lacks player-facing selection metadata.`);
    }
    if (!Array.isArray(preset.selectionTerms) || preset.selectionTerms.length < 1) {
      errors.push(`${prefix} lacks idea selection terms.`);
    } else {
      for (const term of preset.selectionTerms) {
        const normalized = typeof term === 'string' ? term.normalize('NFKC').toLocaleLowerCase('en-US').trim() : '';
        if (!normalized || normalized.length > 64 || selectionTerms.has(normalized)) errors.push(`${prefix} has an invalid or colliding selection term: ${term}.`);
        selectionTerms.add(normalized);
      }
    }
    for (const alias of preset.aliases ?? []) {
      if (!/^[a-z0-9-]+$/.test(alias) || names.has(alias)) errors.push(`${prefix} has an invalid or colliding alias: ${alias}.`);
      names.add(alias);
    }

    const sourceNames = [preset.template, preset.overlay].filter(Boolean);
    const sources = sourceNames.map((source) => path.resolve(assetsRoot, source));
    for (let index = 0; index < sources.length; index += 1) {
      const relativeSource = path.relative(assetsRoot, sources[index]);
      if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) errors.push(`${prefix} source escapes assets: ${sourceNames[index]}.`);
      else if (!(await exists(sources[index]))) errors.push(`${prefix} source is missing: ${sourceNames[index]}.`);
    }
    if (sources.length < 1 || !(await exists(sources[0]))) continue;

    for (const relative of preset.remove ?? []) {
      const resolved = path.resolve(sources[0], relative);
      const withinBase = !path.relative(sources[0], resolved).startsWith('..') && !path.isAbsolute(path.relative(sources[0], resolved));
      if (!withinBase || !(await exists(resolved))) errors.push(`${prefix} removes a path outside its base template: ${relative}.`);
    }

    const effectiveFile = async (relative) => {
      if ((preset.remove ?? []).includes(relative)) return null;
      for (const source of sources.toReversed()) {
        const candidate = path.join(source, relative);
        if (await exists(candidate)) return candidate;
      }
      return null;
    };
    for (const relative of presetRequirements) {
      if (!(await effectiveFile(relative))) errors.push(`${prefix} is missing ${relative} after overlay merge.`);
    }
    const packageFile = await effectiveFile('package.json');
    const lockFile = await effectiveFile('package-lock.json');
    const qualityFile = await effectiveFile('game-quality.json');
    const qualityToolsFile = await effectiveFile('phaser-quality-tools.json');
    const browserFile = await effectiveFile('scripts/browser-e2e.mjs');
    const fingerprintFile = await effectiveFile('scripts/release-fingerprint.mjs');
    const inputDriverFile = await effectiveFile('scripts/quality-input-driver.mjs');
    const inputPlanFile = await effectiveFile('scripts/quality-input-plan.mjs');
    const persistenceProofFile = await effectiveFile('scripts/persistence-proof.mjs');
    const htmlFile = await effectiveFile('index.html');
    const gameSceneFile = await effectiveFile('src/scenes/game-scene.ts');
    const servicesFile = await effectiveFile('src/services.ts');
    const profileFile = await effectiveFile('src/platform/player-profile.ts');
    const profileTestFile = await effectiveFile('src/platform/player-profile.test.ts');
    const controlsFile = await effectiveFile('src/ui/dom-controls.ts');
    const bootSceneFile = await effectiveFile('src/scenes/boot-scene.ts');
    if (!packageFile || !lockFile || !qualityFile || !qualityToolsFile || !browserFile || !fingerprintFile || !inputDriverFile || !inputPlanFile || !persistenceProofFile || !htmlFile || !gameSceneFile) continue;

    const presetPackage = JSON.parse(await readFile(packageFile, 'utf8'));
    if (presetPackage.dependencies?.phaser !== manifest.phaserVersion) {
      errors.push(`${prefix} Phaser ${presetPackage.dependencies?.phaser ?? 'missing'} does not match manifest ${manifest.phaserVersion}.`);
    }
    if (!presetPackage.scripts?.check?.includes('check:bundle')) errors.push(`${prefix} check does not enforce the bundle budget.`);
    if (!presetPackage.scripts?.check?.includes('test:e2e')) errors.push(`${prefix} check does not enforce browser E2E.`);
    if (!presetPackage.scripts?.['test:e2e']) errors.push(`${prefix} lacks the browser E2E script.`);
    if (!presetPackage.scripts?.['check:bundle']) errors.push(`${prefix} lacks the bundle budget script.`);
    const presetLock = JSON.parse(await readFile(lockFile, 'utf8'));
    if (presetLock.packages?.['']?.dependencies?.phaser !== manifest.phaserVersion) {
      errors.push(`${prefix} lockfile Phaser ${presetLock.packages?.['']?.dependencies?.phaser ?? 'missing'} does not match manifest ${manifest.phaserVersion}.`);
    }
    const presetQuality = JSON.parse(await readFile(qualityFile, 'utf8'));
    if (!(presetQuality.bundle?.maximumEntryGzipBytes > 0)) errors.push(`${prefix} lacks a positive compressed entry budget.`);
    if (presetQuality.browser?.mobile?.width !== 390 || presetQuality.browser?.mobile?.height !== 844) {
      errors.push(`${prefix} mobile browser gate must cover 390x844.`);
    }
    const persistenceContract = presetQuality.persistence;
    try {
      parsePersistenceContract(persistenceContract);
    } catch (error) {
      errors.push(`${prefix} has an invalid persistence contract: ${error.message}`);
    }
    const gameplayContract = presetQuality.gameplay;
    for (const field of ['primaryAction', 'progressName', 'auxiliaryName', 'pressureName', 'successReason', 'failureReason']) {
      if (typeof gameplayContract?.[field] !== 'string' || gameplayContract[field].length < 1) {
        errors.push(`${prefix} game-quality.json lacks gameplay.${field}.`);
      }
    }
    for (const field of ['completionTarget', 'maximumPressure']) {
      if (!(Number.isFinite(gameplayContract?.[field]) && gameplayContract[field] > 0)) {
        errors.push(`${prefix} game-quality.json lacks a positive gameplay.${field}.`);
      }
    }
    const qualityTools = JSON.parse(await readFile(qualityToolsFile, 'utf8'));
    if (qualityTools.schemaVersion !== 1 || !Number.isInteger(qualityTools.version) || qualityTools.version < 1) {
      errors.push(`${prefix} has an invalid quality tool manifest version.`);
    }
    const qualityToolVersions = new Set([qualityTools.version]);
    for (const known of qualityTools.knownVersions ?? []) {
      if (!Number.isInteger(known.version) || qualityToolVersions.has(known.version)) errors.push(`${prefix} has a duplicate quality tool version.`);
      qualityToolVersions.add(known.version);
    }
    const legacyFingerprintIds = new Set();
    for (const fingerprint of qualityTools.legacyFingerprints ?? []) {
      if (!/^[a-z0-9-]+$/.test(fingerprint.id ?? '') || legacyFingerprintIds.has(fingerprint.id)) {
        errors.push(`${prefix} has an invalid or duplicate legacy quality tool fingerprint.`);
      }
      legacyFingerprintIds.add(fingerprint.id);
      for (const [relative, expectedHash] of Object.entries(fingerprint.managedFiles ?? {})) {
        if (!relative.startsWith('scripts/') || !/^[a-f0-9]{64}$/.test(expectedHash)) {
          errors.push(`${prefix} has an invalid legacy quality tool fingerprint entry: ${relative}.`);
        }
      }
    }
    for (const [relative, expectedHash] of Object.entries(qualityTools.managedFiles ?? {})) {
      if (!relative.startsWith('scripts/') || path.isAbsolute(relative) || path.normalize(relative).startsWith('..')) {
        errors.push(`${prefix} quality tool path escapes scripts/: ${relative}.`);
        continue;
      }
      const managedFile = await effectiveFile(relative);
      if (!managedFile) errors.push(`${prefix} quality tool is missing: ${relative}.`);
      else if (!/^[a-f0-9]{64}$/.test(expectedHash) || sha256(await readFile(managedFile)) !== expectedHash) {
        errors.push(`${prefix} quality tool hash is stale: ${relative}.`);
      }
    }
    const browserGate = await readFile(browserFile, 'utf8');
    for (const proof of browserProofs) {
      if (!browserGate.includes(proof)) errors.push(`${prefix} browser gate does not prove ${proof}.`);
    }
    for (const token of ['verifyBundleFingerprintEvidence', 'fingerprintProjectRelease', 'Browser E2E freshness']) {
      if (!browserGate.includes(token)) errors.push(`${prefix} browser gate does not enforce release fingerprint token: ${token}.`);
    }
    const fingerprintGate = await readFile(fingerprintFile, 'utf8');
    for (const token of ['fingerprintReleaseInputs', 'fingerprintDist', 'assertProjectFingerprint', 'isSymbolicLink']) {
      if (!fingerprintGate.includes(token)) errors.push(`${prefix} release fingerprint helper lacks token: ${token}.`);
    }
    const persistenceProofGate = await readFile(persistenceProofFile, 'utf8');
    for (const proof of ['equalsFixture', 'incrementedBy', 'derivedFrom', 'validatePersistenceProofSummary', 'forbiddenPathSegments']) {
      if (!persistenceProofGate.includes(proof)) errors.push(`${prefix} persistence proof gate does not enforce ${proof}.`);
    }
    for (const [relative, source] of [
      ['scripts/audit-phaser-project.mjs', path.join(skillRoot, 'scripts', 'audit-phaser-project.mjs')],
      ['scripts/check-phaser-api.mjs', path.join(skillRoot, 'scripts', 'check-phaser-api.mjs')],
      ['scripts/api-anchors.json', path.join(skillRoot, 'references', 'api-anchors.json')],
    ]) {
      const effective = await effectiveFile(relative);
      if (effective && sha256(await readFile(effective)) !== sha256(await readFile(source))) {
        errors.push(`${prefix} managed release checker drifted from ${path.relative(skillRoot, source).replaceAll('\\', '/')}.`);
      }
    }
    const inputDriverGate = await readFile(inputDriverFile, 'utf8');
    for (const deviceProof of ['dispatchMouseAction', 'dispatchTouchAction', 'touchStart', 'touchMove', 'touchEnd']) {
      if (!inputDriverGate.includes(deviceProof)) errors.push(`${prefix} input driver does not prove ${deviceProof}.`);
    }
    const inputPlanGate = await readFile(inputPlanFile, 'utf8');
    for (const vocabulary of ["['click', 'hold', 'drag']", "action.mode === 'directional'", "['pulse', 'hold']", 'horizontalDistanceGreaterThan']) {
      if (!inputPlanGate.includes(vocabulary)) errors.push(`${prefix} input plan schema does not enforce ${vocabulary}.`);
    }
    const presetHtml = await readFile(htmlFile, 'utf8');
    for (const statusId of ['progress-value', 'auxiliary-value', 'pressure-value']) {
      if (!presetHtml.includes(`id="${statusId}"`)) errors.push(`${prefix} lacks responsive status ${statusId}.`);
    }
    if (!presetHtml.includes('class="game-telemetry')) errors.push(`${prefix} lacks the mobile gameplay telemetry band.`);
    const gameScene = await readFile(gameSceneFile, 'utf8');
    for (const field of qualityFields) {
      if (!gameScene.includes(`dataset.${field}`)) errors.push(`${prefix} lacks quality contract field ${field}.`);
    }
    if (preset.id === catalog.defaultPreset
      && (!gameScene.includes('qualityPressureTargets = this.objectPositions(this.drones)') || gameScene.includes('firstObjectPosition'))) {
      errors.push(`${prefix} must publish every live moving pressure target.`);
    }
    if (!gameScene.includes('services.beginRun()')) errors.push(`${prefix} does not record every Scene run start.`);
    const services = await readFile(servicesFile, 'utf8');
    for (const proof of ['PlayerProfileStore', 'profile.beginRun', 'profile.observeRun', 'qualityPlayerProfile', 'qualityProfileStorageKey', 'qualityAudioMuted']) {
      if (!services.includes(proof)) errors.push(`${prefix} services do not publish ${proof}.`);
    }
    const profile = await readFile(profileFile, 'utf8');
    const profileSchemaMatch = profile.match(/PLAYER_PROFILE_SCHEMA_VERSION\s*=\s*(\d+)/);
    const profileSchemaVersion = Number(profileSchemaMatch?.[1] ?? 0);
    if (profileSchemaVersion !== persistenceContract?.schemaVersion) {
      errors.push(`${prefix} player profile schema ${profileSchemaVersion || 'missing'} does not match game-quality.json ${persistenceContract?.schemaVersion ?? 'missing'}.`);
    }
    if (!profile.includes(`profile.schemaVersion === ${persistenceContract?.migrationFromVersion}`)) {
      errors.push(`${prefix} player profile does not implement the declared migration source ${persistenceContract?.migrationFromVersion ?? 'missing'}.`);
    }
    for (const proof of ['PLAYER_PROFILE_SCHEMA_VERSION', 'migrated', 'recovered-backup', 'reset-unsupported-version', ':backup', ':rejected']) {
      if (!profile.includes(proof)) errors.push(`${prefix} player profile does not implement ${proof}.`);
    }
    const profileTests = await readFile(profileTestFile, 'utf8');
    for (const proof of ['records each run outcome once', 'migrates the trusted version 1 shape', 'recovers a previous valid profile', 'unknown future schema']) {
      if (!profileTests.includes(proof)) errors.push(`${prefix} player profile tests do not prove ${proof}.`);
    }
    const controls = await readFile(controlsFile, 'utf8');
    for (const proof of ['profile.snapshot().settings.muted', 'services.setMuted', 'qualitySettingsReady', 'qualitySettingsInteractions']) {
      if (!controls.includes(proof)) errors.push(`${prefix} settings control does not implement ${proof}.`);
    }
    const bootScene = await readFile(bootSceneFile, 'utf8');
    if (!bootScene.includes('profile.snapshot().settings.muted') || bootScene.includes('audio.setMuted(false)')) {
      errors.push(`${prefix} boot Scene does not restore the authoritative profile setting.`);
    }
    for (const source of sources) {
      for (const file of await walk(source)) {
        const relative = path.relative(source, file).replaceAll('\\', '/');
        if (/^(?:node_modules|dist|\.quality)\//.test(relative) || /\.log$/i.test(relative)) {
          errors.push(`${prefix} packages generated or transient content: ${relative}.`);
        }
      }
    }
  }
  if (!ids.has(catalog.defaultPreset)) errors.push(`Preset catalog default does not exist: ${catalog.defaultPreset ?? 'missing'}.`);
  if (verbs.size !== ids.size) errors.push('Every gameplay preset must expose a distinct primary verb.');
  checks.push({ name: 'gameplay-presets', value: ids.size });
  checks.push({ name: 'preset-quality-fields', value: qualityFields.length });

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
    options.phaserRoot = await resolvePhaserRoot(options.phaserRoot);
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
