import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'query-phaser-api.mjs');

async function withPhaserFixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-query-'));
  try {
    await mkdir(path.join(root, 'types'), { recursive: true });
    await mkdir(path.join(root, 'src', 'gameobjects', 'mesh2d'), { recursive: true });
    await mkdir(path.join(root, 'src', 'gameobjects', 'noise'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'phaser', version: '4.2.1', types: './types/phaser.d.ts' }));
    await writeFile(path.join(root, 'types', 'phaser.d.ts'), `
      declare namespace Phaser.GameObjects {
        class GameObjectFactory {
          noisecell2d(config?: object): object;
        }
        class Mesh2D {}
      }
    `);
    await writeFile(path.join(root, 'src', 'gameobjects', 'noise', 'NoiseFactory.js'), "GameObjectFactory.register('noisecell2d', function (config) {});\n");
    await writeFile(path.join(root, 'src', 'gameobjects', 'mesh2d', 'Mesh2D.js'), "setTint2: function (color) { return this; }\n");
    await run(root);
  } finally {
    if (root.startsWith(os.tmpdir())) await rm(root, { recursive: true, force: true });
  }
}

test('finds an owner-scoped declaration and runtime registration', async () => {
  await withPhaserFixture(async (root) => {
    const result = await execFileAsync(process.execPath, [script, root, '--owner', 'GameObjectFactory', '--member', 'noisecell2d', '--json']);
    const report = JSON.parse(result.stdout);
    assert.equal(report.summary.status, 'declared');
    assert.equal(report.summary.declarations, 1);
    assert.ok(report.summary.sources >= 1);
  });
});

test('reports a runtime-only method without hiding declaration drift', async () => {
  await withPhaserFixture(async (root) => {
    const result = await execFileAsync(process.execPath, [script, root, '--owner', 'Mesh2D', '--member', 'setTint2', '--json']);
    const report = JSON.parse(result.stdout);
    assert.equal(report.summary.status, 'runtime-only-or-internal');
    assert.equal(report.summary.declarations, 0);
    assert.ok(report.summary.sources >= 1);
  });
});

test('rejects an API name that is absent from declarations and registrations', async () => {
  await withPhaserFixture(async (root) => {
    await assert.rejects(
      execFileAsync(process.execPath, [script, root, '--owner', 'GameObjectFactory', '--member', 'noiseCell2D', '--json']),
      (error) => error.code === 2 && JSON.parse(error.stdout).summary.status === 'not-found',
    );
  });
});
