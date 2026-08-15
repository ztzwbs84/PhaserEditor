import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { createGame, listPresets, loadPresetCatalog, parseArguments, publishStagingDirectory, readQualityEvidence, resolveProjectIdentity, resolveSpawnCommand, selectPresetFromIdea } from './create-phaser-game.mjs';
import { fingerprintProjectRelease } from '../assets/arcade-starter/scripts/release-fingerprint.mjs';
import { verifyPersistenceProofPhase } from '../assets/arcade-starter/scripts/persistence-proof.mjs';

const temporaryRoots = [];
const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const script = path.resolve(scriptDirectory, 'create-phaser-game.mjs');
const customTemplateRoot = path.resolve(scriptDirectory, '..', 'assets', 'arcade-starter');

test.afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-skill-create-'));
  temporaryRoots.push(root);
  return root;
}

function stockPersistenceContract() {
  return {
    required: true,
    migrationFromVersion: 1,
    migrationFixture: { schemaVersion: 1, muted: true, bestProgress: 1 },
    schemaVersion: 2,
    proofs: {
      migration: [
        { path: 'schemaVersion', op: 'equals', value: 2 },
        { path: 'settings.muted', op: 'equalsFixture', fixturePath: 'muted' },
        { path: 'stats.runsStarted', op: 'equals', value: 1 },
        { path: 'stats.runsCompleted', op: 'equals', value: 0 },
        { path: 'stats.wins', op: 'equals', value: 0 },
        { path: 'stats.losses', op: 'equals', value: 0 },
        { path: 'stats.bestProgress', op: 'equalsFixture', fixturePath: 'bestProgress' }
      ],
      gameplay: [
        { path: 'schemaVersion', op: 'preserved' },
        { path: 'settings.muted', op: 'preserved' },
        { path: 'stats.runsStarted', op: 'incrementedBy', amount: 4 },
        { path: 'stats.runsCompleted', op: 'incrementedBy', amount: 2 },
        { path: 'stats.wins', op: 'incrementedBy', amount: 1 },
        { path: 'stats.losses', op: 'incrementedBy', amount: 1 },
        { path: 'stats.bestProgress', op: 'derivedFrom', source: 'successProgress' }
      ],
      reload: [
        { path: 'schemaVersion', op: 'preserved' },
        { path: 'settings.muted', op: 'preserved' },
        { path: 'stats.runsStarted', op: 'incrementedBy', amount: 1 },
        { path: 'stats.runsCompleted', op: 'preserved' },
        { path: 'stats.wins', op: 'preserved' },
        { path: 'stats.losses', op: 'preserved' },
        { path: 'stats.bestProgress', op: 'preserved' }
      ]
    }
  };
}

function persistenceSummary(contract, profiles, progress = { success: 60, failure: 0 }) {
  return {
    status: 'pass',
    migration: {
      status: 'pass', fromVersion: contract.migrationFromVersion, toVersion: contract.schemaVersion,
      loadStatus: 'migrated', muted: profiles.migration.settings.muted,
      audioMuted: profiles.migration.settings.muted, settingsInteractions: 1,
      proof: verifyPersistenceProofPhase(contract, 'migration', { profile: profiles.migration, progress })
    },
    gameplay: {
      status: 'pass',
      proof: verifyPersistenceProofPhase(contract, 'gameplay', {
        profile: profiles.gameplay, previousProfile: profiles.migration, progress
      })
    },
    reload: {
      status: 'pass', schemaVersion: contract.schemaVersion, loadStatus: 'current',
      muted: profiles.reload.settings.muted, audioMuted: profiles.reload.settings.muted, settingsInteractions: 1,
      proof: verifyPersistenceProofPhase(contract, 'reload', {
        profile: profiles.reload, previousProfile: profiles.gameplay, progress
      })
    }
  };
}

function stockProfiles() {
  return {
    migration: { schemaVersion: 2, settings: { muted: true }, stats: { runsStarted: 1, runsCompleted: 0, wins: 0, losses: 0, bestProgress: 1 } },
    gameplay: { schemaVersion: 2, settings: { muted: true }, stats: { runsStarted: 5, runsCompleted: 2, wins: 1, losses: 1, bestProgress: 60 } },
    reload: { schemaVersion: 2, settings: { muted: true }, stats: { runsStarted: 6, runsCompleted: 2, wins: 1, losses: 1, bestProgress: 60 } }
  };
}

function auxiliarySummary(name = 'time', value = 60) {
  return {
    name,
    value,
    checkpoints: Object.fromEntries([
      'desktopInitial', 'failureTerminal', 'failureRestart', 'successTerminal',
      'successRestart', 'mobileInitial', 'mobileProgress'
    ].map((checkpoint) => [checkpoint, { name, value, visibleValue: value }]))
  };
}

function terminalInputLockSummary(terminalKind, overrides = {}) {
  const snapshot = {
    phase: 'game-over',
    run: terminalKind === 'success' ? 4 : 2,
    progress: terminalKind === 'success' ? 60 : 0,
    pressure: terminalKind === 'success' ? 3 : 0,
    playerPosition: '480,300',
    terminalKind,
    terminalReason: terminalKind === 'success' ? 'target-reached' : 'shield-depleted',
    auxiliaryName: 'time',
    auxiliaryValue: 56,
    auxiliaryVisibleValue: 56,
    acceptedInputs: { 'pointer:click': 8 },
    ...overrides
  };
  return {
    terminalKind,
    actions: ['mouse:pointer:click'],
    before: snapshot,
    after: structuredClone(snapshot)
  };
}

function pauseFreezeSummary() {
  const pausedSnapshot = {
    phase: 'paused', run: 1, progress: 0, pressure: 3, playerPosition: '480,300',
    terminalKind: '', terminalReason: '', auxiliaryName: 'time', auxiliaryValue: 60,
    auxiliaryVisibleValue: 60, pauseLabel: 'Resume', pausePressed: 'true',
    acceptedInputs: { 'pointer:click': 0 }
  };
  const resumedSnapshot = {
    ...pausedSnapshot,
    phase: 'playing',
    pauseLabel: 'Pause',
    pausePressed: 'false'
  };
  return {
    actions: ['mouse:pointer:click'],
    observedMs: 1_100,
    before: pausedSnapshot,
    after: structuredClone(pausedSnapshot),
    resumed: {
      observedMs: 300,
      before: resumedSnapshot,
      after: structuredClone(resumedSnapshot)
    }
  };
}

test('parses the one-command install and verification contract', () => {
  const options = parseArguments(['game', '--name', 'Solar Run', '--title', 'Solar Run', '--idea', 'deliver cargo', '--preset', 'courier', '--install', '--verify']);
  assert.equal(options.name, 'Solar Run');
  assert.equal(options.title, 'Solar Run');
  assert.equal(options.preset, 'courier');
  assert.equal(options.idea, 'deliver cargo');
  assert.equal(options.install, true);
  assert.equal(options.verify, true);
});

test('accepts an idea as the complete one-command project identity input', () => {
  const options = parseArguments(['--idea', '极光悬浮赛车：漂移通过检查点', '--install', '--verify']);
  assert.equal(options.output, null);
  assert.equal(options.name, null);
  assert.equal(options.title, null);
  assert.equal(options.idea, '极光悬浮赛车：漂移通过检查点');
  assert.equal(options.install, true);
  assert.equal(options.verify, true);
  assert.throws(() => parseArguments([]), /Provide an output directory or --idea/);
});

test('derives stable safe project identities from Chinese and English ideas', () => {
  const cwd = path.resolve('identity-root');
  const racing = { id: 'racing', metadata: { label: 'Circuit Racing' } };
  const chinese = resolveProjectIdentity({
    output: null, name: null, title: null, idea: '极光悬浮赛车：漂移通过赛道检查点完成一圈'
  }, racing, cwd);
  assert.equal(chinese.title, '极光悬浮赛车');
  assert.match(chinese.name, /^racing-[a-f0-9]{10}$/);
  assert.equal(chinese.output, path.join(cwd, chinese.name));
  assert.deepEqual(chinese.sources, {
    output: 'project-name', name: 'idea-hash', title: 'idea'
  });
  assert.deepEqual(chinese, resolveProjectIdentity({
    output: null, name: null, title: null, idea: '极光悬浮赛车：漂移通过赛道检查点完成一圈'
  }, racing, cwd));

  const english = resolveProjectIdentity({
    output: null, name: null, title: null, idea: 'Build an Aurora Hover Racer: drift through every checkpoint.'
  }, racing, cwd);
  assert.equal(english.title, 'Aurora Hover Racer');
  assert.match(english.name, /^aurora-hover-racer-[a-f0-9]{10}$/);
  assert.equal(english.output, path.join(cwd, english.name));
  assert.equal(english.sources.name, 'idea-slug');

  const different = resolveProjectIdentity({
    output: null, name: null, title: null, idea: '霓虹悬浮赛车：漂移通过赛道检查点完成一圈'
  }, racing, cwd);
  assert.notEqual(different.name, chinese.name);
  assert.notEqual(different.output, chinese.output);
});

test('keeps explicit output, package name, and title authoritative', () => {
  const cwd = path.resolve('identity-root');
  const output = path.join(cwd, 'explicit-output');
  const identity = resolveProjectIdentity({
    output, name: 'Custom Package', title: 'Custom Title', idea: '极光悬浮赛车：漂移通过检查点'
  }, { id: 'racing', metadata: { label: 'Circuit Racing' } }, cwd);
  assert.deepEqual(identity, {
    output,
    name: 'custom-package',
    title: 'Custom Title',
    sources: { output: 'explicit', name: 'explicit', title: 'explicit' }
  });
  assert.throws(() => resolveProjectIdentity({
    output: null, name: 'con', title: null, idea: 'race checkpoints'
  }, { id: 'racing', metadata: { label: 'Circuit Racing' } }, cwd), /project name is reserved/);
});

test('selects an unambiguous preset from English and Chinese game ideas', async () => {
  const catalog = await loadPresetCatalog();
  const courier = selectPresetFromIdea(catalog, 'A courier must deliver cargo along a dangerous route.');
  assert.equal(courier.preset.id, 'courier');
  assert.deepEqual(courier.matchedTerms, ['deliver', 'courier', 'route']);
  assert.equal(courier.score, 3);

  const platformer = selectPresetFromIdea(catalog, '做一个横版平台跳跃跑酷游戏');
  assert.equal(platformer.preset.id, 'platformer');
  assert.deepEqual(platformer.matchedTerms, ['跳跃', '平台', '跑酷', '横版']);

  const shooter = selectPresetFromIdea(catalog, '做一个太空战机射击弹幕游戏');
  assert.equal(shooter.preset.id, 'shooter');
  assert.deepEqual(shooter.matchedTerms, ['射击', '战机', '弹幕']);

  const breakout = selectPresetFromIdea(catalog, '做一个打砖块游戏，用球拍反弹小球');
  assert.equal(breakout.preset.id, 'breakout');
  assert.deepEqual(breakout.matchedTerms, ['打砖块', '砖块', '球拍', '反弹小球']);

  const racing = selectPresetFromIdea(catalog, '做一个赛车竞速游戏，漂移通过赛道检查点');
  assert.equal(racing.preset.id, 'racing');
  assert.deepEqual(racing.matchedTerms, ['赛车', '竞速', '赛道', '检查点', '漂移']);

  const defense = selectPresetFromIdea(catalog, '建造炮塔抵御波次敌人保护核心');
  assert.equal(defense.preset.id, 'tower-defense');
  assert.deepEqual(defense.matchedTerms, ['炮塔', '抵御']);
});

test('fails closed for an unmatched or tied game idea', async () => {
  const catalog = await loadPresetCatalog();
  assert.throws(() => selectPresetFromIdea(catalog, 'Build a turn based deck builder.'), /does not unambiguously match/);
  assert.throws(() => selectPresetFromIdea(catalog, 'A survival platformer.'), /ambiguous between collector, platformer/);
  assert.throws(() => selectPresetFromIdea(catalog, '   '), /requires a non-empty game description/);
  assert.throws(() => selectPresetFromIdea(catalog, 'x'.repeat(1_001)), /at most 1000 characters/);
});

test('rejects duplicate or oversized catalog selection terms', async () => {
  const catalog = await loadPresetCatalog();
  const duplicate = structuredClone(catalog);
  duplicate.presets[1].selectionTerms.push(duplicate.presets[0].selectionTerms[0]);
  assert.throws(() => selectPresetFromIdea(duplicate, 'collect'), /Invalid or duplicate preset selection term/);

  const invalid = structuredClone(catalog);
  invalid.presets[0].selectionTerms = ['x'.repeat(65)];
  assert.throws(() => selectPresetFromIdea(invalid, 'collect'), /Invalid or duplicate preset selection term/);
});

test('uses explicit preset as the authority when an idea is also supplied', async () => {
  const root = await temporaryRoot();
  const report = await createGame({
    output: path.join(root, 'explicit'), preset: 'courier', idea: 'jump platform climb',
    install: false, verify: false, dryRun: true
  });
  assert.equal(report.preset, 'courier');
  assert.deepEqual(report.presetSelection, { method: 'explicit', matchedTerms: [], score: null });
});

test('reports auditable idea selection in dry-run and generated metadata', async () => {
  const root = await temporaryRoot();
  const dryRun = await createGame({
    output: path.join(root, 'dry'), idea: '配送路线到灯塔', install: false, verify: false, dryRun: true
  });
  assert.equal(dryRun.preset, 'courier');
  assert.equal(dryRun.presetSelection.method, 'idea');
  assert.deepEqual(dryRun.presetSelection.matchedTerms, ['配送', '路线', '灯塔']);

  const output = path.join(root, 'generated');
  await createGame({ output, idea: 'collect and dodge in an arena', install: false, verify: false, dryRun: false });
  const metadata = JSON.parse(await readFile(path.join(output, 'game-preset.json'), 'utf8'));
  assert.equal(metadata.id, 'collector');
  assert.deepEqual(metadata.selection, {
    method: 'idea', matchedTerms: ['collect', 'dodge', 'arena'], score: 3
  });
  assert.deepEqual(metadata.projectIdentity, {
    schemaVersion: 1,
    name: 'generated',
    title: 'Generated',
    sources: { output: 'explicit', name: 'output-directory', title: 'project-name' }
  });
});

test('creates an idea-only project and records the same generated identity in both surfaces', async () => {
  const root = await temporaryRoot();
  const idea = '极光悬浮赛车：漂移通过赛道检查点完成一圈';
  const report = await createGame({
    output: null, name: null, title: null, idea, cwd: root,
    install: false, verify: false, dryRun: false
  });
  assert.equal(path.dirname(report.output), root);
  assert.equal(report.title, '极光悬浮赛车');
  assert.match(report.name, /^racing-[a-f0-9]{10}$/);
  const metadata = JSON.parse(await readFile(path.join(report.output, 'game-preset.json'), 'utf8'));
  assert.deepEqual(metadata.projectIdentity, report.projectIdentity);
  assert.deepEqual(report.projectIdentity.sources, {
    output: 'project-name', name: 'idea-hash', title: 'idea'
  });
});

test('refuses to overwrite an occupied idea-only generated directory', async () => {
  const root = await temporaryRoot();
  const idea = 'Aurora checkpoint racing drift circuit';
  const identity = resolveProjectIdentity({ output: null, name: null, title: null, idea }, {
    id: 'racing', metadata: { label: 'Circuit Racing' }
  }, root);
  await mkdir(identity.output);
  await writeFile(path.join(identity.output, 'keep.txt'), 'user data', 'utf8');
  await assert.rejects(createGame({
    output: null, name: null, title: null, idea, cwd: root,
    install: false, verify: false, dryRun: false
  }), /Target directory must be empty/);
  assert.equal(await readFile(path.join(identity.output, 'keep.txt'), 'utf8'), 'user data');
});

test('emits parseable idea-only CLI dry-run JSON', async () => {
  const root = await temporaryRoot();
  const result = await execFileAsync(process.execPath, [
    script, '--idea', 'Aurora checkpoint racing drift circuit', '--dry-run', '--json'
  ], { cwd: root });
  const report = JSON.parse(result.stdout);
  assert.match(report.name, /^aurora-checkpoint-racing-drift-circuit-[a-f0-9]{10}$/);
  assert.equal(report.output, path.join(root, report.name));
  assert.equal(report.title, 'Aurora checkpoint racing drift circuit');
  assert.deepEqual(report.projectIdentity.sources, {
    output: 'project-name', name: 'idea-slug', title: 'idea'
  });
});

test('lists the complete preset catalog as parseable JSON', async () => {
  const result = await execFileAsync(process.execPath, [script, '--list-presets', '--json']);
  const report = JSON.parse(result.stdout);

  assert.equal(report.defaultPreset, 'collector');
  assert.deepEqual(report.presets.map((preset) => preset.id), ['collector', 'courier', 'platformer', 'shooter', 'breakout', 'racing', 'chess-puzzle', 'tower-defense']);
  assert.equal(report.presets[0].primaryVerb, 'collect');
  assert.equal(report.presets[1].primaryVerb, 'deliver');
  assert.equal(report.presets[2].primaryVerb, 'jump');
  assert.equal(report.presets[3].primaryVerb, 'shoot');
  assert.equal(report.presets[4].primaryVerb, 'break');
  assert.equal(report.presets[5].primaryVerb, 'race');
  assert.equal(report.presets[6].primaryVerb, 'solve');
  assert.equal(report.presets[7].primaryVerb, 'defend');
  assert.ok(report.presets[1].aliases.includes('delivery'));
  assert.deepEqual(report.presets, await listPresets());
});

test('fails closed for an unknown preset', async () => {
  const root = await temporaryRoot();
  await assert.rejects(createGame({
    output: path.join(root, 'unknown'),
    preset: 'nonexistent-preset',
    install: false,
    verify: false,
    dryRun: true,
  }), /Unknown preset "nonexistent-preset".*collector, courier, platformer, shooter, breakout, racing, chess-puzzle, tower-defense/);
});

test('resolves preset aliases to their canonical metadata', async () => {
  const root = await temporaryRoot();
  const report = await createGame({
    output: path.join(root, 'alias'),
    preset: 'delivery',
    install: false,
    verify: false,
    dryRun: true,
  });

  assert.equal(report.preset, 'courier');
  assert.equal(report.presetMetadata.id, 'courier');
  assert.equal(report.presetMetadata.primaryVerb, 'deliver');
});

test('generates the default collector preset with canonical metadata', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'collector');
  const report = await createGame({ output, install: false, verify: false, dryRun: false });
  const metadata = JSON.parse(await readFile(path.join(output, 'game-preset.json'), 'utf8'));
  const quality = JSON.parse(await readFile(path.join(output, 'game-quality.json'), 'utf8'));
  const gameSource = await readFile(path.join(output, 'src', 'scenes', 'game-scene.ts'), 'utf8');
  const indexHtml = await readFile(path.join(output, 'index.html'), 'utf8');

  assert.equal(report.preset, 'collector');
  assert.deepEqual(report.presetSelection, { method: 'default', matchedTerms: [], score: null });
  assert.equal(metadata.id, 'collector');
  assert.deepEqual(metadata.selection, { method: 'default', matchedTerms: [], score: null });
  assert.equal(metadata.default, true);
  assert.equal(metadata.primaryVerb, 'collect');
  assert.deepEqual(quality.gameplay, {
    primaryAction: 'collect-signal', progressName: 'score', completionTarget: 150,
    auxiliaryName: 'time',
    pressureName: 'shield', maximumPressure: 3,
    successReason: 'target-reached', failureReason: 'shield-depleted'
  });
  assert.match(gameSource, /qualityPrimaryAction = 'collect-signal'/);
  assert.match(gameSource, /qualityInputPlan = JSON\.stringify/);
  assert.match(gameSource, /qualityAcceptedInputs = JSON\.stringify/);
  assert.match(gameSource, /acceptedInputs\.accept\('pointer:click'\)/);
  assert.match(gameSource, /acceptedInputs\.snapshot\(\)/);
  assert.match(gameSource, /Distance\.Between\(this\.player\.x, this\.player\.y, candidateX, candidateY\) >= 110/);
  assert.match(gameSource, /qualityPressureTargets = this\.objectPositions\(this\.drones\)/);
  assert.doesNotMatch(gameSource, /firstObjectPosition/);
  assert.match(gameSource, /qualityCompletionTarget = String\(RUN_COMPLETION_TARGET\)/);
  assert.match(gameSource, /qualityTerminalKind = snapshot\.terminalKind/);
  assert.match(gameSource, /physics\.world\.resume\(\)/);
  assert.match(indexHtml, /class="game-telemetry"/);
  assert.deepEqual((await readdir(path.join(output, 'public', 'assets'))).sort(), ['drone.svg', 'field.svg', 'player.svg', 'shard.svg']);
});

test('merges the courier overlay without leaking collector assets', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'courier');
  const report = await createGame({ output, preset: 'routes', install: false, verify: false, dryRun: false });
  const metadata = JSON.parse(await readFile(path.join(output, 'game-preset.json'), 'utf8'));
  const quality = JSON.parse(await readFile(path.join(output, 'game-quality.json'), 'utf8'));
  const gameSource = await readFile(path.join(output, 'src', 'scenes', 'game-scene.ts'), 'utf8');
  const indexHtml = await readFile(path.join(output, 'index.html'), 'utf8');

  assert.equal(report.preset, 'courier');
  assert.equal(metadata.id, 'courier');
  assert.equal(metadata.default, false);
  assert.equal(metadata.primaryVerb, 'deliver');
  assert.deepEqual(quality.gameplay, {
    primaryAction: 'deliver-north', progressName: 'deliveries', completionTarget: 3,
    auxiliaryName: 'time',
    pressureName: 'flame', maximumPressure: 3,
    successReason: 'deliveries-complete', failureReason: 'extinguished'
  });
  assert.match(gameSource, /qualityProgressName = 'deliveries'/);
  assert.match(gameSource, /qualityCompletionTarget = String\(RUN_COMPLETION_TARGET\)/);
  assert.match(gameSource, /qualityTerminalKind = snapshot\.terminalKind/);
  assert.match(gameSource, /`deliver-\$\{cargo\.destination\}`/);
  assert.match(indexHtml, /class="game-telemetry route-telemetry"/);
  assert.deepEqual((await readdir(path.join(output, 'public', 'assets'))).sort(), [
    'courier.svg', 'ember.svg', 'field.svg', 'gate.svg', 'hearth.svg', 'wisp.svg'
  ]);
});

test('generates the platformer overlay with distinct rules and assets', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'platformer');
  const report = await createGame({ output, preset: 'jumper', install: false, verify: false, dryRun: false });
  const metadata = JSON.parse(await readFile(path.join(output, 'game-preset.json'), 'utf8'));
  const quality = JSON.parse(await readFile(path.join(output, 'game-quality.json'), 'utf8'));
  const gameSource = await readFile(path.join(output, 'src', 'scenes', 'game-scene.ts'), 'utf8');
  const indexHtml = await readFile(path.join(output, 'index.html'), 'utf8');

  assert.equal(report.preset, 'platformer');
  assert.equal(metadata.id, 'platformer');
  assert.equal(metadata.primaryVerb, 'jump');
  assert.deepEqual(quality.gameplay, {
    primaryAction: 'jump-to-relic', progressName: 'relics', completionTarget: 3,
    auxiliaryName: 'time',
    pressureName: 'hearts', maximumPressure: 3,
    successReason: 'relics-complete', failureReason: 'hearts-depleted'
  });
  assert.match(gameSource, /qualityProgressName = 'relics'/);
  assert.match(gameSource, /qualityCompletionTarget = String\(RUN_COMPLETION_TARGET\)/);
  assert.match(gameSource, /qualityTerminalKind = snapshot\.terminalKind/);
  assert.match(gameSource, /type: 'key', mode: 'pulse'/);
  assert.match(gameSource, /qualityPressureTargets = JSON\.stringify\(SPIKES\.map\(\(\{ x, y \}\) => \[x - 30, y\]\)\)/);
  assert.match(gameSource, /addPlatform\(WORLD_WIDTH \/ 2, GROUND_Y, WORLD_WIDTH - 48\)/);
  assert.match(gameSource, /const GROUND_Y = 492/);
  assert.match(gameSource, /const RESTART = \{ x: 120, y: 450 \}/);
  assert.match(gameSource, /\.setSize\(34, 54\)/);
  assert.match(indexHtml, /class="game-telemetry ascent-telemetry"/);
  assert.deepEqual((await readdir(path.join(output, 'public', 'assets'))).sort(), [
    'platform.svg', 'relic.svg', 'runner.svg', 'skyline.svg', 'spike.svg'
  ]);
});

test('generates the shooter overlay with physical projectiles and distinct assets', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'shooter');
  const report = await createGame({ output, preset: 'starfighter', install: false, verify: false, dryRun: false });
  const metadata = JSON.parse(await readFile(path.join(output, 'game-preset.json'), 'utf8'));
  const quality = JSON.parse(await readFile(path.join(output, 'game-quality.json'), 'utf8'));
  const gameSource = await readFile(path.join(output, 'src', 'scenes', 'game-scene.ts'), 'utf8');
  const modelSource = await readFile(path.join(output, 'src', 'domain', 'run-model.ts'), 'utf8');
  const indexHtml = await readFile(path.join(output, 'index.html'), 'utf8');

  assert.equal(report.preset, 'shooter');
  assert.equal(metadata.id, 'shooter');
  assert.equal(metadata.primaryVerb, 'shoot');
  assert.deepEqual(quality.gameplay, {
    primaryAction: 'destroy-raider', progressName: 'kills', completionTarget: 4,
    auxiliaryName: 'wave',
    pressureName: 'shield', maximumPressure: 3,
    successReason: 'sector-cleared', failureReason: 'shield-depleted'
  });
  assert.match(gameSource, /physics\.add\.overlap\(this\.bolts, this\.enemies, this\.hitEnemy/);
  assert.match(gameSource, /acceptedInputs = new AcceptedInputCounters\(\['pointer:click', 'key:pulse'\]/);
  assert.match(gameSource, /qualityPrimaryAction = 'destroy-raider'/);
  assert.match(gameSource, /qualityPrimaryTargets = target/);
  assert.match(gameSource, /qualityPressureTargets = target/);
  assert.match(gameSource, /type: 'key', mode: 'pulse'/);
  assert.match(modelSource, /destroyRaider\(\): number/);
  assert.match(indexHtml, /class="game-telemetry shooter-telemetry"/);
  assert.deepEqual((await readdir(path.join(output, 'public', 'assets'))).sort(), [
    'bolt.svg', 'fighter.svg', 'raider.svg', 'starfield.svg'
  ]);
});

test('generates the breakout overlay with paddle physics and distinct assets', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'breakout');
  const report = await createGame({ output, preset: 'brick-breaker', install: false, verify: false, dryRun: false });
  const metadata = JSON.parse(await readFile(path.join(output, 'game-preset.json'), 'utf8'));
  const quality = JSON.parse(await readFile(path.join(output, 'game-quality.json'), 'utf8'));
  const gameSource = await readFile(path.join(output, 'src', 'scenes', 'game-scene.ts'), 'utf8');
  const modelSource = await readFile(path.join(output, 'src', 'domain', 'run-model.ts'), 'utf8');
  const indexHtml = await readFile(path.join(output, 'index.html'), 'utf8');

  assert.equal(report.preset, 'breakout');
  assert.equal(metadata.id, 'breakout');
  assert.equal(metadata.primaryVerb, 'break');
  assert.deepEqual(quality.gameplay, {
    primaryAction: 'break-brick', progressName: 'bricks', completionTarget: 4,
    auxiliaryName: 'round',
    pressureName: 'balls', maximumPressure: 3,
    successReason: 'wall-cleared', failureReason: 'balls-depleted'
  });
  assert.match(gameSource, /physics\.add\.collider\(this\.ball, this\.paddle, this\.hitPaddle/);
  assert.match(gameSource, /physics\.add\.collider\(this\.ball, this\.bricks, this\.hitBrick/);
  assert.match(gameSource, /acceptedInputs = new AcceptedInputCounters\(\['pointer:click', 'key:pulse'\]/);
  assert.match(gameSource, /qualityPrimaryAction = 'break-brick'/);
  assert.match(gameSource, /qualityPrimaryTargets = JSON\.stringify\(this\.activeBricks/);
  assert.match(gameSource, /qualityPressureTargets = JSON\.stringify/);
  assert.match(gameSource, /type: 'key', mode: 'pulse'/);
  assert.match(modelSource, /dropBall\(\): boolean/);
  assert.match(indexHtml, /class="game-telemetry breakout-telemetry"/);
  assert.deepEqual((await readdir(path.join(output, 'public', 'assets'))).sort(), [
    'ball.svg', 'brick.svg', 'court.svg', 'paddle.svg'
  ]);
});

test('generates the racing overlay with inertial checkpoints and distinct assets', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'racing');
  const report = await createGame({ output, preset: 'racer', install: false, verify: false, dryRun: false });
  const metadata = JSON.parse(await readFile(path.join(output, 'game-preset.json'), 'utf8'));
  const quality = JSON.parse(await readFile(path.join(output, 'game-quality.json'), 'utf8'));
  const gameSource = await readFile(path.join(output, 'src', 'scenes', 'game-scene.ts'), 'utf8');
  const modelSource = await readFile(path.join(output, 'src', 'domain', 'run-model.ts'), 'utf8');
  const indexHtml = await readFile(path.join(output, 'index.html'), 'utf8');

  assert.equal(report.preset, 'racing');
  assert.equal(metadata.id, 'racing');
  assert.equal(metadata.primaryVerb, 'race');
  assert.deepEqual(quality.gameplay, {
    primaryAction: 'clear-checkpoint', progressName: 'checkpoints', completionTarget: 4,
    auxiliaryName: 'lap',
    pressureName: 'chassis', maximumPressure: 3,
    successReason: 'lap-complete', failureReason: 'chassis-wrecked'
  });
  assert.match(gameSource, /const CHECKPOINTS = \[/);
  assert.match(gameSource, /racerBody\.setAllowGravity\(false\)\.setDrag\(230, 230\)\.setMaxSpeed\(MAX_SPEED\)/);
  assert.match(gameSource, /physics\.add\.overlap\(this\.racer, checkpoint\.zone, this\.reachCheckpoint/);
  assert.match(gameSource, /physics\.add\.collider\(this\.racer, this\.barrier, this\.hitBarrier/);
  assert.match(gameSource, /checkpointIndex !== this\.model\.snapshot\(\)\.checkpoints/);
  assert.match(gameSource, /acceptedInputs = new AcceptedInputCounters\(\['pointer:click', 'key:pulse'\]/);
  assert.match(gameSource, /qualityPrimaryAction = 'clear-checkpoint'/);
  assert.match(gameSource, /type: 'key', mode: 'pulse'/);
  assert.match(modelSource, /crash\(\): boolean/);
  assert.match(indexHtml, /class="game-telemetry racing-telemetry"/);
  assert.deepEqual((await readdir(path.join(output, 'public', 'assets'))).sort(), [
    'barrier.svg', 'checkpoint.svg', 'circuit.svg', 'racer.svg'
  ]);
});

test('generates the tower defense overlay with pathing invaders and distinct assets', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'tower-defense');
  const report = await createGame({ output, preset: 'td', install: false, verify: false, dryRun: false });
  const metadata = JSON.parse(await readFile(path.join(output, 'game-preset.json'), 'utf8'));
  const quality = JSON.parse(await readFile(path.join(output, 'game-quality.json'), 'utf8'));
  const gameSource = await readFile(path.join(output, 'src', 'scenes', 'game-scene.ts'), 'utf8');
  const modelSource = await readFile(path.join(output, 'src', 'domain', 'run-model.ts'), 'utf8');
  const indexHtml = await readFile(path.join(output, 'index.html'), 'utf8');

  assert.equal(report.preset, 'tower-defense');
  assert.equal(metadata.id, 'tower-defense');
  assert.equal(metadata.primaryVerb, 'defend');
  assert.deepEqual(quality.gameplay, {
    primaryAction: 'intercept-invader', progressName: 'intercepts', completionTarget: 4,
    auxiliaryName: 'wave',
    pressureName: 'core', maximumPressure: 3,
    successReason: 'sector-defended', failureReason: 'core-breached'
  });
  assert.match(gameSource, /const PATH = \[/);
  assert.match(gameSource, /const TURRETS = \[/);
  assert.match(gameSource, /const RESTART = TURRETS\[1\]/);
  assert.match(gameSource, /physics\.add\.overlap\(this\.pulses, this\.enemies, this\.hitEnemy/);
  assert.match(gameSource, /acceptedInputs = new AcceptedInputCounters\(\['pointer:click', 'key:pulse'\]/);
  assert.match(gameSource, /qualityPrimaryAction = 'intercept-invader'/);
  assert.match(gameSource, /qualityPrimaryTargets = target/);
  assert.match(gameSource, /qualityPressureTargets = target/);
  assert.match(gameSource, /type: 'key', mode: 'pulse'/);
  assert.match(modelSource, /breach\(\): boolean/);
  assert.match(indexHtml, /class="game-telemetry defense-telemetry"/);
  assert.deepEqual((await readdir(path.join(output, 'public', 'assets'))).sort(), [
    'citadel.svg', 'core.svg', 'invader.svg', 'pulse.svg', 'turret.svg'
  ]);
});

test('routes Windows npm command scripts through ComSpec', () => {
  const command = resolveSpawnCommand('npm', ['run', 'check'], 'win32');
  assert.match(command.executable.toLowerCase(), /cmd\.exe$/);
  assert.deepEqual(command.args, ['/d', '/s', '/c', 'npm.cmd', 'run', 'check']);
});

test('retries a transient Windows directory rename before publishing', async () => {
  const root = await temporaryRoot();
  const staging = path.join(root, '.stage');
  const output = path.join(root, 'release');
  await mkdir(staging);
  await writeFile(path.join(staging, 'package.json'), '{"name":"retry-release"}\n', 'utf8');
  let attempts = 0;
  const pauses = [];

  const result = await publishStagingDirectory(staging, output, 'retry-release', {
    renameDirectory: async (source, destination) => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('busy'), { code: 'EPERM' });
      await (await import('node:fs/promises')).rename(source, destination);
    },
    pause: async (milliseconds) => pauses.push(milliseconds),
  });

  assert.deepEqual(result, { attempts: 2, confirmedAfterError: false });
  assert.deepEqual(pauses, [40]);
  assert.equal(JSON.parse(await readFile(path.join(output, 'package.json'), 'utf8')).name, 'retry-release');
});

test('confirms a completed Windows rename even when the call reports EPERM', async () => {
  const root = await temporaryRoot();
  const staging = path.join(root, '.stage');
  const output = path.join(root, 'release');
  await mkdir(staging);
  await writeFile(path.join(staging, 'package.json'), '{"name":"confirmed-release"}\n', 'utf8');
  const { rename: renameDirectory } = await import('node:fs/promises');

  const result = await publishStagingDirectory(staging, output, 'confirmed-release', {
    renameDirectory: async (source, destination) => {
      await renameDirectory(source, destination);
      throw Object.assign(new Error('late EPERM'), { code: 'EPERM' });
    },
    pause: async () => assert.fail('a confirmed publication must not retry'),
  });

  assert.deepEqual(result, { attempts: 1, confirmedAfterError: true });
});

test('refuses a transient rename error when a concurrent target appears', async () => {
  const root = await temporaryRoot();
  const staging = path.join(root, '.stage');
  const output = path.join(root, 'release');
  await mkdir(staging);
  await writeFile(path.join(staging, 'package.json'), '{"name":"owned-release"}\n', 'utf8');

  await assert.rejects(publishStagingDirectory(staging, output, 'owned-release', {
    renameDirectory: async () => {
      await mkdir(output);
      await writeFile(path.join(output, 'package.json'), '{"name":"other-release"}\n', 'utf8');
      throw Object.assign(new Error('busy'), { code: 'EPERM' });
    },
    pause: async () => assert.fail('a concurrent target must not retry'),
  }), /busy/);
  assert.equal(await readFile(path.join(staging, 'package.json'), 'utf8'), '{"name":"owned-release"}\n');
  assert.equal(JSON.parse(await readFile(path.join(output, 'package.json'), 'utf8')).name, 'other-release');
});

test('creates a complete starter and replaces all public tokens', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'signal-garden');
  const report = await createGame({
    output,
    name: 'Signal Garden',
    title: "Pilot's <Signal> & Garden",
    install: false,
    verify: false,
    dryRun: false,
    templateRoot: customTemplateRoot,
  });

  const packageJson = JSON.parse(await readFile(path.join(output, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await readFile(path.join(output, 'package-lock.json'), 'utf8'));
  const quality = JSON.parse(await readFile(path.join(output, 'game-quality.json'), 'utf8'));
  const qualityTools = JSON.parse(await readFile(path.join(output, 'phaser-quality-tools.json'), 'utf8'));
  const indexHtml = await readFile(path.join(output, 'index.html'), 'utf8');
  const mainSource = await readFile(path.join(output, 'src', 'main.ts'), 'utf8');
  assert.equal(report.name, 'signal-garden');
  assert.equal(packageJson.name, 'signal-garden');
  assert.equal(packageLock.name, 'signal-garden');
  const bootSource = await readFile(path.join(output, 'src', 'scenes', 'boot-scene.ts'), 'utf8');
  assert.match(indexHtml, /Pilot&#39;s &lt;Signal&gt; &amp; Garden/);
  assert.match(bootSource, /"Pilot's <Signal> & Garden"/);
  assert.doesNotMatch(`${indexHtml}${mainSource}${bootSource}`, /__(?:PACKAGE_NAME|GAME_TITLE(?:_HTML|_JSON)?)__/);
  assert.equal(packageJson.dependencies.phaser, '4.2.1');
  assert.match(packageJson.scripts.check, /npm run check:bundle/);
  assert.match(packageJson.scripts.check, /npm run test:e2e/);
  assert.match(packageJson.scripts.test, /vitest run src --no-cache/);
  assert.ok(quality.bundle.maximumEntryGzipBytes > 0);
  assert.equal(quality.browser.mobile.width, 390);
  assert.deepEqual(quality.persistence, stockPersistenceContract());
  assert.deepEqual(quality.gameplay, {
    primaryAction: 'collect-signal',
    progressName: 'score',
    completionTarget: 150,
    auxiliaryName: 'time',
    pressureName: 'shield',
    maximumPressure: 3,
    successReason: 'target-reached',
    failureReason: 'shield-depleted',
  });
  assert.equal(qualityTools.schemaVersion, 1);
  assert.equal(qualityTools.version, 23);
  assert.ok(qualityTools.managedFiles['scripts/browser-e2e.mjs']);
  assert.ok(qualityTools.managedFiles['scripts/browser-e2e.test.mjs']);
  assert.ok(qualityTools.managedFiles['scripts/audit-phaser-project.mjs']);
  assert.ok(qualityTools.managedFiles['scripts/check-phaser-api.mjs']);
  assert.ok(qualityTools.managedFiles['scripts/check-release.mjs']);
  assert.ok(qualityTools.managedFiles['scripts/api-anchors.json']);
  assert.ok(qualityTools.managedFiles['scripts/release-fingerprint.mjs']);
  assert.ok(qualityTools.managedFiles['scripts/release-fingerprint.test.mjs']);
  const generatorSource = await readFile(new URL('./create-phaser-game.mjs', import.meta.url), 'utf8');
  assert.match(await readFile(path.join(output, 'scripts', 'browser-e2e.mjs'), 'utf8'), /runReleaseChecks/);
  assert.match(await readFile(path.join(output, 'scripts', 'check-release.mjs'), 'utf8'), /phaser-audit\.json/);
  assert.match(generatorSource, /updateQualityTools/);
  assert.doesNotMatch(generatorSource, /runJsonTool/);
  assert.match(generatorSource, /\['ci', '--no-audit', '--no-fund'\]/);
  const readme = await readFile(path.join(output, 'README.md'), 'utf8');
  assert.match(readme, /npm ci/);
  assert.doesNotMatch(readme, /npm install/);
});

test('excludes transient template directories from generated releases', async () => {
  const root = await temporaryRoot();
  const dirtyTemplate = path.join(root, 'dirty-template');
  const output = path.join(root, 'clean-output');
  await mkdir(path.join(dirtyTemplate, 'node_modules', '.cache'), { recursive: true });
  await mkdir(path.join(dirtyTemplate, 'dist'), { recursive: true });
  await mkdir(path.join(dirtyTemplate, '.quality'), { recursive: true });
  await writeFile(path.join(dirtyTemplate, 'package.json'), '{"name":"__PACKAGE_NAME__"}', 'utf8');
  await writeFile(path.join(dirtyTemplate, 'node_modules', '.cache', 'result.json'), '{}', 'utf8');
  await writeFile(path.join(dirtyTemplate, 'dist', 'bundle.js'), 'generated', 'utf8');
  await writeFile(path.join(dirtyTemplate, '.quality', 'evidence.json'), '{}', 'utf8');

  const report = await createGame({ output, install: false, verify: false, dryRun: false, templateRoot: dirtyTemplate });
  assert.equal(report.fileCount, 2);
  await assert.rejects(stat(path.join(output, 'node_modules')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(output, 'dist')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(output, '.quality')), { code: 'ENOENT' });
});

test('prints parseable JSON for automation preflight', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'json-preflight');
  const result = await execFileAsync(process.execPath, [script, output, '--name', 'JSON Preflight', '--dry-run', '--json']);
  const report = JSON.parse(result.stdout);

  assert.equal(report.name, 'json-preflight');
  assert.equal(report.dryRun, true);
  assert.equal(report.quality, null);
});

test('refuses to write into a non-empty directory', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'occupied');
  await mkdir(output);
  await writeFile(path.join(output, 'keep.txt'), 'user data', 'utf8');

  await assert.rejects(createGame({
    output,
    name: null,
    title: null,
    install: false,
    verify: false,
    dryRun: false,
    templateRoot: customTemplateRoot,
  }), /must be empty/);
  assert.equal(await readFile(path.join(output, 'keep.txt'), 'utf8'), 'user data');
});

test('publishes nothing when verification fails before release', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'failed-release');
  await assert.rejects(createGame({
    output,
    install: false,
    verify: true,
    dryRun: false,
    templateRoot: customTemplateRoot,
  }), /Verification requires installed dependencies/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
  assert.deepEqual((await readdir(root)).filter((name) => name.includes('phaser-stage')), []);
});

test('preserves an existing empty target when verification fails', async () => {
  const root = await temporaryRoot();
  const output = path.join(root, 'empty-target');
  await mkdir(output);
  await assert.rejects(createGame({
    output,
    install: false,
    verify: true,
    dryRun: false,
    templateRoot: customTemplateRoot,
  }), /Verification requires installed dependencies/);
  assert.deepEqual(await readdir(output), []);
  assert.deepEqual((await readdir(root)).filter((name) => name.includes('phaser-stage')), []);
});

test('accepts only the standard browser quality summary', async () => {
  const root = await temporaryRoot();
  const qualityRoot = path.join(root, '.quality');
  await mkdir(qualityRoot);
  await mkdir(path.join(root, 'dist', 'assets'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'index.html'), '<main></main>\n', 'utf8');
  await writeFile(path.join(root, 'dist', 'assets', 'index.js'), 'console.log("release")\n', 'utf8');
  await writeFile(path.join(root, 'game-quality.json'), JSON.stringify({
    persistence: stockPersistenceContract(),
    gameplay: {
      primaryAction: 'collect-signal',
      progressName: 'score',
      completionTarget: 60,
      auxiliaryName: 'time',
      pressureName: 'shield',
      maximumPressure: 3,
      successReason: 'target-reached',
      failureReason: 'shield-depleted'
    }
  }), 'utf8');
  let fingerprints = await fingerprintProjectRelease(root);
  await writeFile(path.join(qualityRoot, 'bundle-budget.json'), JSON.stringify({
    status: 'pass',
    failures: [],
    fingerprints,
    summary: { largestEntry: { bytes: 10, gzipBytes: 5 }, totalBytes: 10, totalGzipBytes: 5 }
  }), 'utf8');
  await writeFile(path.join(qualityRoot, 'phaser-audit.json'), JSON.stringify({
    fingerprints, summary: { error: 0, warning: 0, info: 0 }, findings: []
  }), 'utf8');
  await writeFile(path.join(qualityRoot, 'phaser-api.json'), JSON.stringify({
    fingerprints, summary: { pass: 25, fail: 0, skipped: 0 }, results: []
  }), 'utf8');
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify({ fingerprints, summary: {
    status: 'pass',
    viewports: { desktop: { width: 1280, height: 720 }, mobile: { width: 390, height: 844 } },
    interactions: {
      desktopPointer: ['mouse:pointer:click'],
      desktopKeyboard: ['keyboard:navigate:directional'],
      desktopPrimaryKeyboard: [],
      mobilePointer: {
        actions: ['touch:pointer:click'], progressName: 'score', before: 0, after: 10,
        inputAcceptance: { actions: ['pointer:click'], before: { 'pointer:click': 0 }, after: { 'pointer:click': 1 } }
      }
    },
    gameplay: {
      primaryAction: 'collect-signal',
      inputPlan: { schemaVersion: 1, primary: ['pointer:click'], pressure: ['pointer:click', 'navigate:directional'] },
      inputAcceptance: {
        actions: ['pointer:click'], before: { 'pointer:click': 0 }, after: { 'pointer:click': 1 }
      },
      pauseFreeze: pauseFreezeSummary(),
      auxiliary: auxiliarySummary(),
      progress: { name: 'score', before: 0, after: 60, target: 60 },
      success: {
        terminalState: 'game-over',
        terminalKind: 'success',
        terminalReason: 'target-reached',
        inputLock: terminalInputLockSummary('success'),
        restart: { progress: 0, pressure: 3, run: 4, playableProgress: 10, cleanupRun: 5 }
      },
      failure: {
        pressure: { name: 'shield', before: 3, after: 0, events: 3 },
        progress: 0,
        terminalState: 'game-over',
        terminalKind: 'failure',
        terminalReason: 'shield-depleted',
        inputLock: terminalInputLockSummary('failure'),
        restart: { progress: 0, pressure: 3, run: 2, playableProgress: 10, cleanupRun: 3 }
      }
    },
    persistence: persistenceSummary(stockPersistenceContract(), stockProfiles()),
    errors: { consoleMessages: 0, exceptions: 0, failedResponses: 0 }
  } }), 'utf8');

  async function refreshFingerprints(browserEvidence) {
    fingerprints = await fingerprintProjectRelease(root);
    browserEvidence.fingerprints = fingerprints;
    const bundleEvidence = JSON.parse(await readFile(path.join(qualityRoot, 'bundle-budget.json'), 'utf8'));
    bundleEvidence.fingerprints = fingerprints;
    await writeFile(path.join(qualityRoot, 'bundle-budget.json'), JSON.stringify(bundleEvidence), 'utf8');
    for (const name of ['phaser-audit.json', 'phaser-api.json']) {
      const releaseEvidence = JSON.parse(await readFile(path.join(qualityRoot, name), 'utf8'));
      releaseEvidence.fingerprints = fingerprints;
      await writeFile(path.join(qualityRoot, name), JSON.stringify(releaseEvidence), 'utf8');
    }
  }

  const evidence = await readQualityEvidence(root);
  assert.equal(evidence.browser.status, 'pass');
  assert.equal(evidence.bundle.entryGzipBytes, 5);

  const forgedAudit = JSON.parse(await readFile(path.join(qualityRoot, 'phaser-audit.json'), 'utf8'));
  forgedAudit.fingerprints.releaseInputs.digest = '0'.repeat(64);
  await writeFile(path.join(qualityRoot, 'phaser-audit.json'), JSON.stringify(forgedAudit), 'utf8');
  await assert.rejects(readQualityEvidence(root), /Bundle\/audit freshness/);
  forgedAudit.fingerprints = fingerprints;
  await writeFile(path.join(qualityRoot, 'phaser-audit.json'), JSON.stringify(forgedAudit), 'utf8');

  const forgedApi = JSON.parse(await readFile(path.join(qualityRoot, 'phaser-api.json'), 'utf8'));
  forgedApi.fingerprints.dist.digest = '0'.repeat(64);
  await writeFile(path.join(qualityRoot, 'phaser-api.json'), JSON.stringify(forgedApi), 'utf8');
  await assert.rejects(readQualityEvidence(root), /Bundle\/API freshness/);
  forgedApi.fingerprints = fingerprints;
  await writeFile(path.join(qualityRoot, 'phaser-api.json'), JSON.stringify(forgedApi), 'utf8');

  await writeFile(path.join(root, 'freshness-probe.txt'), 'changed after verification\n', 'utf8');
  await assert.rejects(readQualityEvidence(root), /releaseInputs do not match/);
  await rm(path.join(root, 'freshness-probe.txt'));
  await writeFile(path.join(root, 'dist', 'assets', 'index.js'), 'console.log("changed after verification")\n', 'utf8');
  await assert.rejects(readQualityEvidence(root), /dist does not match/);
  await writeFile(path.join(root, 'dist', 'assets', 'index.js'), 'console.log("release")\n', 'utf8');

  const futureQuality = JSON.parse(await readFile(path.join(root, 'game-quality.json'), 'utf8'));
  futureQuality.persistence = {
    required: true,
    migrationFromVersion: 2,
    migrationFixture: {
      schemaVersion: 2,
      settings: { muted: true },
      stats: { runsStarted: 9, runsCompleted: 7, wins: 4, losses: 3, bestProgress: 37 }
    },
    schemaVersion: 3,
    proofs: {
      migration: [
        { path: 'schemaVersion', op: 'equals', value: 3 },
        { path: 'settings.muted', op: 'equalsFixture' },
        { path: 'stats.runsStarted', op: 'incrementedBy', amount: 1 },
        { path: 'stats.runsCompleted', op: 'equalsFixture' },
        { path: 'economy.lifetimeCredits', op: 'derivedFrom', source: 'fixture', sourcePath: 'stats.bestProgress' }
      ],
      gameplay: [
        { path: 'schemaVersion', op: 'preserved' },
        { path: 'settings.muted', op: 'preserved' },
        { path: 'stats.runsStarted', op: 'incrementedBy', amount: 4 },
        { path: 'stats.runsCompleted', op: 'incrementedBy', amount: 2 },
        { path: 'economy.lifetimeCredits', op: 'incrementedBy', source: 'successProgress' }
      ],
      reload: [
        { path: 'schemaVersion', op: 'preserved' },
        { path: 'settings.muted', op: 'preserved' },
        { path: 'stats.runsStarted', op: 'incrementedBy', amount: 1 },
        { path: 'stats.runsCompleted', op: 'preserved' },
        { path: 'economy.lifetimeCredits', op: 'preserved' }
      ]
    }
  };
  const futureProfiles = {
    migration: {
      schemaVersion: 3, settings: { muted: true },
      stats: { runsStarted: 10, runsCompleted: 7, wins: 4, losses: 3, bestProgress: 37 },
      economy: { lifetimeCredits: 37 }
    },
    gameplay: {
      schemaVersion: 3, settings: { muted: true },
      stats: { runsStarted: 14, runsCompleted: 9, wins: 5, losses: 4, bestProgress: 60 },
      economy: { lifetimeCredits: 97 }
    },
    reload: {
      schemaVersion: 3, settings: { muted: true },
      stats: { runsStarted: 15, runsCompleted: 9, wins: 5, losses: 4, bestProgress: 60 },
      economy: { lifetimeCredits: 97 }
    }
  };
  const futureEvidence = JSON.parse(await readFile(path.join(qualityRoot, 'browser-e2e.json'), 'utf8'));
  futureEvidence.summary.persistence = persistenceSummary(futureQuality.persistence, futureProfiles);
  await writeFile(path.join(root, 'game-quality.json'), JSON.stringify(futureQuality), 'utf8');
  await refreshFingerprints(futureEvidence);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');
  assert.equal((await readQualityEvidence(root)).browser.persistence.reload.schemaVersion, 3);
  futureQuality.persistence = stockPersistenceContract();
  futureEvidence.summary.persistence = persistenceSummary(stockPersistenceContract(), stockProfiles());
  await writeFile(path.join(root, 'game-quality.json'), JSON.stringify(futureQuality), 'utf8');
  await refreshFingerprints(futureEvidence);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  futureEvidence.summary.gameplay.auxiliary = auxiliarySummary('time', 0);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');
  assert.equal((await readQualityEvidence(root)).browser.gameplay.auxiliary.value, 0);
  futureEvidence.summary.gameplay.auxiliary = auxiliarySummary();

  const mismatchedAuxiliary = structuredClone(futureEvidence);
  mismatchedAuxiliary.summary.gameplay.auxiliary.name = 'archive-layer';
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(mismatchedAuxiliary), 'utf8');
  await assert.rejects(readQualityEvidence(root), /does not match game-quality\.json/);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const forgedTerminalLock = structuredClone(futureEvidence);
  forgedTerminalLock.summary.gameplay.success.inputLock.after.progress += 1;
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(forgedTerminalLock), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const forgedPauseFreeze = structuredClone(futureEvidence);
  forgedPauseFreeze.summary.gameplay.pauseFreeze.after.auxiliaryValue = 59;
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(forgedPauseFreeze), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const missingPauseInput = structuredClone(futureEvidence);
  missingPauseInput.summary.gameplay.pauseFreeze.actions = [];
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(missingPauseInput), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const leakedPausedInput = structuredClone(futureEvidence);
  leakedPausedInput.summary.gameplay.pauseFreeze.resumed.after.acceptedInputs['pointer:click'] += 1;
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(leakedPausedInput), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const autonomousResume = structuredClone(futureEvidence);
  autonomousResume.summary.gameplay.pauseFreeze.resumed.after.playerPosition = '540,300';
  autonomousResume.summary.gameplay.pauseFreeze.resumed.after.auxiliaryValue = 59;
  autonomousResume.summary.gameplay.pauseFreeze.resumed.after.auxiliaryVisibleValue = 59;
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(autonomousResume), 'utf8');
  assert.equal((await readQualityEvidence(root)).browser.gameplay.pauseFreeze.resumed.after.playerPosition, '540,300');
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const forgedAcceptance = structuredClone(futureEvidence);
  forgedAcceptance.summary.gameplay.inputAcceptance.after['pointer:click'] = 0;
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(forgedAcceptance), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const extraAcceptedKey = structuredClone(futureEvidence);
  extraAcceptedKey.summary.gameplay.success.inputLock.after.extra = 0;
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(extraAcceptedKey), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const missingResumeProof = structuredClone(futureEvidence);
  delete missingResumeProof.summary.gameplay.pauseFreeze.resumed;
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(missingResumeProof), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const missingTerminalInput = structuredClone(futureEvidence);
  missingTerminalInput.summary.gameplay.failure.inputLock.actions = [];
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(missingTerminalInput), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const driftedAuxiliary = structuredClone(futureEvidence);
  driftedAuxiliary.summary.gameplay.auxiliary.checkpoints.successRestart.visibleValue = 59;
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(driftedAuxiliary), 'utf8');
  await assert.rejects(readQualityEvidence(root), /does not match game-quality\.json/);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const mismatchedContract = JSON.parse(await readFile(path.join(root, 'game-quality.json'), 'utf8'));
  mismatchedContract.gameplay.completionTarget = 61;
  await writeFile(path.join(root, 'game-quality.json'), JSON.stringify(mismatchedContract), 'utf8');
  await refreshFingerprints(futureEvidence);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');
  await assert.rejects(readQualityEvidence(root), /does not match game-quality\.json/);
  mismatchedContract.gameplay.completionTarget = 60;
  await writeFile(path.join(root, 'game-quality.json'), JSON.stringify(mismatchedContract), 'utf8');
  await refreshFingerprints(futureEvidence);
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(futureEvidence), 'utf8');

  const missingTouchProgress = JSON.parse(await readFile(path.join(qualityRoot, 'browser-e2e.json'), 'utf8'));
  missingTouchProgress.summary.interactions.mobilePointer.after = 0;
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(missingTouchProgress), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);

  const forgedTouchAction = structuredClone(missingTouchProgress);
  forgedTouchAction.summary.interactions.mobilePointer.after = 10;
  forgedTouchAction.summary.interactions.mobilePointer.actions = ['touch:pointer:drag'];
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(forgedTouchAction), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);

  const mismatchedMobileProgress = structuredClone(missingTouchProgress);
  mismatchedMobileProgress.summary.interactions.mobilePointer.after = 10;
  mismatchedMobileProgress.summary.interactions.mobilePointer.progressName = 'deliveries';
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(mismatchedMobileProgress), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);

  const missingDeclaredPrimaryInput = structuredClone(missingTouchProgress);
  missingDeclaredPrimaryInput.summary.interactions.mobilePointer.after = 10;
  missingDeclaredPrimaryInput.summary.gameplay.inputPlan.primary.push('pointer:hold');
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(missingDeclaredPrimaryInput), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);

  const pressureKeyboardCannotProvePrimary = structuredClone(missingTouchProgress);
  pressureKeyboardCannotProvePrimary.summary.interactions.mobilePointer.after = 10;
  pressureKeyboardCannotProvePrimary.summary.gameplay.inputPlan.primary.push('key:hold');
  pressureKeyboardCannotProvePrimary.summary.gameplay.inputPlan.pressure.push('key:hold');
  pressureKeyboardCannotProvePrimary.summary.interactions.desktopKeyboard.push('keyboard:key:hold');
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(pressureKeyboardCannotProvePrimary), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);

  const missingPersistence = structuredClone(missingTouchProgress);
  missingPersistence.summary.interactions.mobilePointer.after = 10;
  delete missingPersistence.summary.persistence;
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(missingPersistence), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);

  const forgedReload = structuredClone(missingTouchProgress);
  forgedReload.summary.interactions.mobilePointer.after = 10;
  forgedReload.summary.persistence.reload.proof.assertions.find(({ path: field }) => field === 'stats.runsCompleted').actual = 3;
  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify(forgedReload), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);

  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify({
    fingerprints,
    summary: { status: 'pass', desktop: { collection: true }, errors: {} }
  }), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);

  await writeFile(path.join(qualityRoot, 'browser-e2e.json'), JSON.stringify({ fingerprints, summary: {
    status: 'pass',
    viewports: { desktop: { width: 1280, height: 720 }, mobile: { width: 390, height: 844 } },
    interactions: {
      desktopPointer: ['mouse:pointer:click'],
      desktopKeyboard: ['keyboard:key:pulse'],
      desktopPrimaryKeyboard: [],
      mobilePointer: { actions: ['touch:pointer:click'], progressName: 'score', before: 0, after: 10 }
    },
    gameplay: {
      primaryAction: 'collect-signal',
      inputPlan: { schemaVersion: 1, primary: ['pointer:click'], pressure: ['pointer:click', 'navigate:directional'] },
      progress: { name: 'score', before: 0, after: 10, target: 60 },
      success: {
        terminalState: 'game-over',
        terminalKind: 'success',
        terminalReason: 'target-reached',
        restart: { progress: 0, pressure: 3, run: 4, playableProgress: 10, cleanupRun: 5 }
      },
      failure: {
        pressure: { name: 'shield', before: 3, after: 0, events: 3 },
        terminalState: 'game-over',
        terminalKind: 'failure',
        restart: { progress: 0, pressure: 3, run: 2, playableProgress: 10, cleanupRun: 3 }
      }
    },
    errors: { consoleMessages: 0, exceptions: 0, failedResponses: 0 }
  } }), 'utf8');
  await assert.rejects(readQualityEvidence(root), /standard preset summary/);
});
