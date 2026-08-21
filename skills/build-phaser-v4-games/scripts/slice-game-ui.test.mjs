import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'slice-game-ui.py');

async function findPython() {
  const candidates = [
    process.env.CODEX_PYTHON ? { command: process.env.CODEX_PYTHON, prefix: [] } : null,
    process.env.PYTHON ? { command: process.env.PYTHON, prefix: [] } : null,
    process.platform === 'win32' ? { command: 'py', prefix: ['-3'] } : null,
    { command: 'python3', prefix: [] },
    { command: 'python', prefix: [] },
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate.command, [...candidate.prefix, '-c', 'from PIL import Image']);
      return candidate;
    } catch {
      // Try the next installed Python runtime.
    }
  }
  return null;
}

async function runPython(runtime, args) {
  return execFileAsync(runtime.command, [...runtime.prefix, ...args]);
}

test('cuts nine source regions and verifies Phaser-style previews', async (context) => {
  const python = await findPython();
  if (!python) return context.skip('Python with Pillow is unavailable.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-ui-slice-'));
  const source = path.join(root, 'panel.png');
  const output = path.join(root, 'output');
  try {
    const createFixture = [
      'from PIL import Image, ImageDraw',
      'import sys',
      "image = Image.new('RGBA', (12, 10), (30, 40, 50, 255))",
      'draw = ImageDraw.Draw(image)',
      'draw.rectangle((0, 0, 2, 1), fill=(255, 0, 0, 255))',
      'draw.rectangle((9, 0, 11, 1), fill=(0, 255, 0, 255))',
      'draw.rectangle((0, 8, 2, 9), fill=(0, 0, 255, 255))',
      'draw.rectangle((9, 8, 11, 9), fill=(255, 255, 0, 255))',
      'image.save(sys.argv[1])',
    ].join('; ');
    await runPython(python, ['-c', createFixture, source]);
    const result = await runPython(python, [
      script,
      source,
      '--insets', '3', '2', '3', '2',
      '--out-dir', output,
      '--preview', '18x14',
      '--preview', '24x20',
      '--preview', '6x4',
      '--tile-x',
      '--filter', 'nearest',
    ]);
    const report = JSON.parse(result.stdout);
    const manifest = JSON.parse(await readFile(path.join(output, 'slice-manifest.json'), 'utf8'));
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(manifest.scale9Borders, { x: 3, y: 2, w: 6, h: 6 });
    assert.equal(manifest.slices.length, 9);
    assert.equal(manifest.previews.length, 3);
    assert.ok(manifest.previews.every((preview) => preview.fixedCornersVerified));
    assert.ok(manifest.previews.some((preview) => preview.width === 6 && preview.height === 4));
    assert.equal(manifest.phaser.renderer, 'Phaser.WEBGL');
    assert.equal(manifest.phaser.resizeMethod, 'setSize');
    assert.equal(manifest.phaser.tileX, true);
    assert.equal(manifest.acceptance.fixedCornersVerifiedAutomatically, true);
    assert.equal(manifest.acceptance.visualReviewRequired, true);
    assert.ok(manifest.acceptance.review.some((item) => item.includes('distorted motifs')));
    assert.equal((await stat(path.join(output, 'slices', 'center.png'))).isFile(), true);
    assert.equal((await stat(path.join(output, 'slice-guide.png'))).isFile(), true);

    await assert.rejects(
      runPython(python, [
        script,
        source,
        '--insets', '3', '2', '3', '2',
        '--out-dir', output,
      ]),
      (error) => error.stderr.includes('Output directory must be empty'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects previews smaller than the fixed borders', async (context) => {
  const python = await findPython();
  if (!python) return context.skip('Python with Pillow is unavailable.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-ui-slice-invalid-'));
  const source = path.join(root, 'panel.png');
  try {
    await runPython(python, [
      '-c',
      "from PIL import Image; import sys; Image.new('RGBA', (12, 10), (0, 0, 0, 0)).save(sys.argv[1])",
      source,
    ]);
    await assert.rejects(
      runPython(python, [
        script,
        source,
        '--insets', '3', '2', '3', '2',
        '--out-dir', path.join(root, 'output'),
        '--preview', '5x3',
      ]),
      (error) => error.stderr.includes('smaller than fixed borders 6x4'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
