import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { checkPhaserApi, resolvePhaserRoot } from './check-phaser-api.mjs';

const execFileAsync = promisify(execFile);
const checkerScript = fileURLToPath(new URL('./check-phaser-api.mjs', import.meta.url));

async function createPackage(root, version = '4.2.1') {
  await mkdir(path.join(root, 'types'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'phaser',
    version,
    types: './types/phaser.d.ts',
    exports: { '.': './dist/phaser.js', './package.json': './package.json' },
  }));
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    skill: 'fixture',
    targetMajor: 4,
    validatedVersion: '4.2.1',
    packageExpectations: {
      name: 'phaser',
      types: './types/phaser.d.ts',
      rootExports: ['.', './package.json'],
    },
    anchors: [
      {
        id: 'owner-method',
        description: 'Method belongs to Owner.',
        since: '4.0.0',
        declaration: {
          path: 'types/phaser.d.ts',
          scopePattern: '^\\s*class Owner \\{',
          memberPatterns: ['ok\\(value: number\\): this;'],
        },
        sources: [{ path: 'src/Owner.js', patterns: ['ok: function \\(value\\)'] }],
      },
      {
        id: 'future-method',
        description: 'Future method is skipped.',
        since: '4.3.0',
        declaration: {
          path: 'types/phaser.d.ts',
          scopePattern: '^\\s*class Future \\{',
          memberPatterns: ['later\\(\\): void;'],
        },
      },
    ],
    knownDivergences: [
      {
        id: 'known-omission',
        description: 'Runtime method is absent from the declaration.',
        since: '4.2.0',
        until: '4.2.1',
        declaration: {
          path: 'types/phaser.d.ts',
          scopePattern: '^\\s*class Owner \\{',
          absentPatterns: ['runtimeOnly\\('],
        },
        sources: [{ path: 'src/Owner.js', patterns: ['runtimeOnly: function \\(\\)'] }],
      },
    ],
    ...overrides,
  };
}

async function withFixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-api-'));
  try {
    await createPackage(root);
    await writeFile(path.join(root, 'types', 'phaser.d.ts'), `
      declare namespace Phaser {
        class Owner {
          ok(value: number): this;
        }
        class Other {
          onlyThere(): void;
        }
      }
    `);
    await writeFile(path.join(root, 'src', 'Owner.js'), `
      module.exports = {
        ok: function (value) { return this; },
        runtimeOnly: function () { return true; }
      };
    `);
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeManifest(root, value, name = 'anchors.json') {
  const file = path.join(root, name);
  await writeFile(file, JSON.stringify(value));
  return file;
}

test('validates scoped anchors, known divergences, and version skips', async () => {
  await withFixture(async (root) => {
    const anchors = await writeManifest(root, manifest());
    const report = await checkPhaserApi(root, anchors);
    assert.deepEqual(report.summary, { pass: 2, fail: 0, skipped: 1 });
    assert.equal(report.results.find((item) => item.id === 'known-omission').status, 'pass');
    assert.equal(report.results.find((item) => item.id === 'future-method').status, 'skipped');
  });
});

test('does not accept a same-named method from another class scope', async () => {
  await withFixture(async (root) => {
    const value = manifest();
    value.anchors[0].declaration.memberPatterns = ['onlyThere\\(\\): void;'];
    const anchors = await writeManifest(root, value);
    const report = await checkPhaserApi(root, anchors);
    assert.equal(report.summary.fail, 1);
    assert.match(report.results[0].problems[0], /onlyThere/);
  });
});

test('resolves a Phaser package from a project node_modules tree', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'phaser-project-'));
  try {
    const packageRoot = path.join(project, 'node_modules', 'phaser');
    await createPackage(packageRoot);
    const resolved = await resolvePhaserRoot(path.join(project, 'src'));
    assert.equal(resolved.root, packageRoot);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects a non-v4 package before inspecting anchors', async () => {
  await withFixture(async (root) => {
    const packageJson = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'package.json'), 'utf8'));
    packageJson.version = '3.90.0';
    await writeFile(path.join(root, 'package.json'), JSON.stringify(packageJson));
    const anchors = await writeManifest(root, manifest());
    await assert.rejects(() => checkPhaserApi(root, anchors), /target major 4/);
  });
});

test('emits parseable JSON and exits with one when an API anchor fails', async () => {
  await withFixture(async (root) => {
    const value = manifest();
    value.anchors[0].declaration.memberPatterns = ['missingMethod\\(\\): void;'];
    const anchors = await writeManifest(root, value);

    await assert.rejects(
      execFileAsync(process.execPath, [checkerScript, root, '--anchors', anchors, '--json']),
      (error) => error.code === 1 && JSON.parse(error.stdout).summary.fail === 1,
    );
  });
});
