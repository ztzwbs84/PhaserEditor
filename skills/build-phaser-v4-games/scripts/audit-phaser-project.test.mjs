import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { audit } from './audit-phaser-project.mjs';

const execFileAsync = promisify(execFile);
const auditScript = fileURLToPath(new URL('./audit-phaser-project.mjs', import.meta.url));

async function withProject(files, callback, phaserVersion = '^4.2.1') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-audit-'));
  try {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'audit-fixture',
      dependencies: { phaser: phaserVersion },
    }));

    for (const [relative, source] of Object.entries(files)) {
      const absolute = path.join(root, relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, source);
    }

    await callback(await audit(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function findingsFor(report, rule) {
  return report.findings.filter((finding) => finding.rule === rule);
}

test('ignores migration-looking comments, strings, and unrelated source', async () => {
  await withProject({
    'src/scene.ts': `
      import Phaser from 'phaser';
      // this.add.mesh(0, 0); object.preFX.addGlow();
      const docs = "Phaser.Geom.Point this.add.customContext()";
      export class SafeScene extends Phaser.Scene {}
    `,
    'src/unrelated.ts': `
      const Phaser = 'not an import';
      object.preFX.addGlow();
      this.add.mesh(0, 0);
    `,
  }, (report) => {
    assert.equal(report.phaserSourceFiles, 1);
    assert.equal(report.findings.length, 0);
  });
});

test('excludes project tooling scripts from the product source audit', async () => {
  await withProject({
    'src/scene.ts': `import Phaser from 'phaser'; export class SafeScene extends Phaser.Scene {}`,
    'scripts/quality-rule.mjs': `import Phaser from 'phaser'; new Phaser.Geom.Point(); Phaser.Math.PI2;`,
  }, (report) => {
    assert.equal(report.sourceFiles, 1);
    assert.equal(report.phaserSourceFiles, 1);
    assert.equal(report.findings.length, 0);
  });
});

test('detects Phaser 3 migration APIs and Phaser 4.2 factory casing errors', async () => {
  await withProject({
    'src/legacy.ts': `
      import Phaser from 'phaser';
      export class LegacyScene extends Phaser.Scene {
        create() {
          this.add.mesh(0, 0, 'mesh');
          sprite.setPipeline('legacy');
          sprite.preFX.addGlow();
          sprite.setTintFill(0xff0000);
          const point = new Phaser.Geom.Point();
          this.add.customContext(0, 0);
          this.make.customcontext({});
          this.add.mesh2D(0, 0, 'mesh', [], []);
          this.add.stencilReference(stencil);
          this.game.loop.fpsLimit = 30;
        }
      }
    `,
  }, (report) => {
    for (const rule of [
      'v3-pipeline-api',
      'v3-fx-api',
      'v3-tint-fill',
      'v3-geom-point',
      'custom-context-factory-casing',
      'custom-context-creator-casing',
      'mesh2d-factory-casing',
      'stencil-reference-factory-casing',
      'direct-fps-limit-mutation',
    ]) {
      assert.ok(findingsFor(report, rule).length >= 1, `expected ${rule}`);
    }
  });
});

test('detects invalid camel-case Noise factories and accepts lowercase registrations', async () => {
  await withProject({
    'src/noise.ts': `
      import Phaser from 'phaser';
      export class NoiseScene extends Phaser.Scene {
        create() {
          this.add.noiseCell2D({}, 0, 0, 64, 64);
          this.add.noiseSimplex3D({}, 0, 0, 64, 64);
          this.add.noisecell3d({}, 0, 0, 64, 64);
          this.make.noisesimplex2d({ add: true });
        }
      }
    `,
  }, (report) => {
    assert.equal(findingsFor(report, 'noise-factory-casing').length, 2);
  });
});

test('finds hot-loop, loader, and global listener ownership risks', async () => {
  await withProject({
    'src/hot.ts': `
      import Phaser from 'phaser';
      export class HotScene extends Phaser.Scene {
        create() {
          this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur, this);
          this.load.image('late', '/late.png');
        }
        update() {
          this.add.sprite(0, 0, 'hero');
          this.label.setText('tick');
          this.load.image('frame', '/frame.png');
        }
      }
    `,
  }, (report) => {
    assert.equal(findingsFor(report, 'game-event-lifecycle').length, 1);
    assert.ok(findingsFor(report, 'loader-outside-preload-without-start').length >= 1);
    assert.equal(findingsFor(report, 'hot-update-allocation').length, 1);
    assert.equal(findingsFor(report, 'hot-update-text-rasterization').length, 1);
    assert.equal(findingsFor(report, 'load-inside-update').length, 1);
  });
});

test('correlates render texture, physics, and GPU tilemap ownership', async () => {
  await withProject({
    'src/systems.ts': `
      import Phaser from 'phaser';
      export class SystemsScene extends Phaser.Scene {
        create() {
          const rt = this.add.renderTexture(0, 0, 64, 64);
          rt.draw(this.hero);
          this.physics.add.existing(player);
          this.matter.add.gameObject(player);
          const layer = map.createLayer('Ground', tileset, 0, 0, true);
          layer.putTileAt(4, 2, 3);
        }
      }
    `,
  }, (report) => {
    assert.equal(findingsFor(report, 'render-texture-command-not-rendered').length, 1);
    assert.equal(findingsFor(report, 'dual-physics-body').length, 1);
    assert.equal(findingsFor(report, 'gpu-tilemap-stale-data').length, 1);
  });
});

test('detects WebGL and stencil configuration conflicts', async () => {
  await withProject({
    'src/stencil.ts': `
      import Phaser from 'phaser';
      new Phaser.Game({
        type: Phaser.CANVAS,
        render: { stencil: false },
      });
      export class StencilScene extends Phaser.Scene {
        create() {
          this.add.stencil(0, 0, []);
        }
      }
    `,
  }, (report) => {
    assert.equal(findingsFor(report, 'canvas-webgl-feature-conflict').length, 1);
    assert.equal(findingsFor(report, 'stencil-buffer-disabled').length, 1);
  });
});

test('accepts source-verified Phaser 4.2 factory paths and explicit WebGL', async () => {
  await withProject({
    'src/v42.ts': `
      import Phaser from 'phaser';
      new Phaser.Game({ type: Phaser.WEBGL, render: { stencil: true } });
      export class ModernScene extends Phaser.Scene {
        create() {
          this.make.customContext({ children: [] }, true);
          this.add.mesh2d(0, 0, 'mesh', [], []);
          const stencil = this.add.stencil(0, 0, []);
          this.add.stencilreference(stencil);
          const layer = map.createLayer('Ground', tileset, 0, 0, true);
          layer.putTileAt(4, 2, 3);
          layer.generateLayerDataTexture();
          this.game.loop.setFPSLimit(30);
        }
      }
    `,
  }, (report) => {
    assert.equal(report.summary.error, 0);
    assert.equal(report.summary.warning, 0);
  });
});

test('reports unsupported Phaser major versions', async () => {
  await withProject({
    'src/scene.ts': `import Phaser from 'phaser'; export class S extends Phaser.Scene {}`,
  }, (report) => {
    assert.equal(findingsFor(report, 'unsupported-phaser-major').length, 1);
  }, '^3.90.0');
});

test('emits parseable JSON and makes warnings fatal only in strict mode', async () => {
  await withProject({
    'src/warning.ts': `
      import Phaser from 'phaser';
      export class WarningScene extends Phaser.Scene {
        create() {
          this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur, this);
        }
      }
    `,
  }, async (_report, root) => {
    const normal = await execFileAsync(process.execPath, [auditScript, root, '--json']);
    assert.equal(JSON.parse(normal.stdout).summary.warning, 1);

    await assert.rejects(
      execFileAsync(process.execPath, [auditScript, root, '--json', '--strict']),
      (error) => error.code === 1 && JSON.parse(error.stdout).summary.warning === 1,
    );
  });
});
