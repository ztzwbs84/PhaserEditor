import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(scriptDir, 'validate-integrated-skill.mjs');
const skillRoot = path.resolve(scriptDir, '..');
const repositoryRoot = path.resolve(skillRoot, '..', '..');

async function findInstalledPhaser() {
  const candidates = [path.join(repositoryRoot, 'node_modules', 'phaser')];
  const artifactsRoot = path.join(repositoryRoot, 'artifacts');
  for (const entry of (await readdir(artifactsRoot, { withFileTypes: true }).catch(() => []))
    .filter((candidate) => candidate.isDirectory()).toSorted((left, right) => right.name.localeCompare(left.name))) {
    candidates.push(path.join(artifactsRoot, entry.name, 'node_modules', 'phaser'));
  }
  for (const candidate of candidates) {
    if (!(await stat(path.join(candidate, 'src')).catch(() => null))?.isDirectory()) continue;
    const packageJson = JSON.parse(await readFile(path.join(candidate, 'package.json'), 'utf8'));
    if (packageJson.name === 'phaser' && packageJson.version === '4.2.1') return candidate;
  }
  return null;
}

test('the packaged skill has one entry and a complete routed official reference set', async () => {
  const result = await execFileAsync(process.execPath, [script, '--skill-root', skillRoot, '--json']);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'pass');
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.checks.find((check) => check.name === 'single-entry').value, 1);
  assert.equal(report.summary.checks.find((check) => check.name === 'official-topics').value, 28);
  assert.equal(report.summary.checks.find((check) => check.name === 'gameplay-presets').value, 8);
  assert.equal(report.summary.checks.find((check) => check.name === 'preset-quality-fields').value, 18);
});

test('accepts a project root and resolves its installed Phaser package', async (context) => {
  const installedPhaser = await findInstalledPhaser();
  if (!installedPhaser) return context.skip('No installed Phaser 4.2.1 package is available for upstream integration checks.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-integrated-project-'));
  try {
    const modules = path.join(root, 'node_modules');
    await mkdir(modules, { recursive: true });
    await symlink(installedPhaser, path.join(modules, 'phaser'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await execFileAsync(process.execPath, [script, '--skill-root', skillRoot, '--phaser-root', root, '--json']);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'pass');
    assert.equal(path.resolve(report.phaserRoot), path.resolve(root, 'node_modules', 'phaser'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects arbitrary persistence proof expressions in a packaged preset', async (context) => {
  const installedPhaser = await findInstalledPhaser();
  if (!installedPhaser) return context.skip('No installed Phaser 4.2.1 package is available for upstream integration checks.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-integrated-proof-'));
  const copiedSkill = path.join(root, 'skill');
  try {
    await cp(skillRoot, copiedSkill, { recursive: true });
    const qualityFile = path.join(copiedSkill, 'assets', 'arcade-starter', 'game-quality.json');
    const quality = JSON.parse(await readFile(qualityFile, 'utf8'));
    quality.persistence.proofs.gameplay.at(-1).source = 'successProgress + fixture.bestProgress';
    await writeFile(qualityFile, `${JSON.stringify(quality, null, 2)}\n`, 'utf8');

    await assert.rejects(
      execFileAsync(process.execPath, [script, '--skill-root', copiedSkill, '--phaser-root', installedPhaser, '--json']),
      (error) => {
        const report = JSON.parse(error.stdout);
        assert.equal(report.status, 'fail');
        assert.ok(report.errors.some((message) => message.includes('source must be fixture')));
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
