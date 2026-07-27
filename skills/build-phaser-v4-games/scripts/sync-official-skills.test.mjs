import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sync-official-skills.mjs');
const topics = [
  'actions-and-utilities', 'animations', 'audio-and-sound', 'cameras', 'curves-and-paths', 'data-manager',
  'events-system', 'filters-and-postfx', 'game-object-components', 'game-setup-and-config', 'geometry-and-math',
  'graphics-and-shapes', 'groups-and-containers', 'input-keyboard-mouse-touch', 'loading-assets', 'particles',
  'physics-arcade', 'physics-matter', 'render-textures', 'scale-and-responsive', 'scenes', 'sprites-and-images',
  'text-and-bitmaptext', 'tilemaps', 'time-and-timers', 'tweens', 'v3-to-v4-migration', 'v4-new-features',
];

test('vendors all topics as non-triggering references and applies corrections', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-sync-'));
  try {
    const phaserRoot = path.join(root, 'phaser');
    const source = path.join(phaserRoot, 'skills');
    const destination = path.join(root, 'output', '4.2.1');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(phaserRoot, 'package.json'), JSON.stringify({ name: 'phaser', version: '4.2.1', release: 'Test' }));
    await writeFile(path.join(phaserRoot, 'LICENSE.md'), 'MIT\n');

    for (const topic of topics) {
      const topicRoot = path.join(source, topic);
      await mkdir(topicRoot, { recursive: true });
      const extra = topic === 'v4-new-features'
        ? '\n```js\nthis.add.noiseCell2D({});\nthis.add.noiseSimplex3D({});\n```\n'
        : '';
      const filler = topic === 'actions-and-utilities'
        ? `${Array.from({ length: 305 }, (_, index) => `line ${index}`).join('\n')}\n## Second Section\ntext\n`
        : '';
      await writeFile(path.join(topicRoot, 'SKILL.md'), `---\nname: ${topic}\ndescription: test\n---\n# ${topic}\n\n## Quick Start\n\ntext\n${extra}${filler}`);
    }

    const cameraReference = path.join(source, 'cameras', 'references');
    await mkdir(cameraReference, { recursive: true });
    await writeFile(path.join(cameraReference, 'REFERENCE.md'), 'See [animations](../animations/SKILL.md) and `../SKILL.md`.\n');

    const result = await execFileAsync(process.execPath, [
      script, '--source', source, '--phaser-root', phaserRoot, '--destination', destination, '--json',
    ]);
    const report = JSON.parse(result.stdout);
    assert.equal(report.topics, 28);
    assert.equal(report.corrections, 2);

    const outputEntries = await readdir(destination, { recursive: true });
    assert.equal(outputEntries.some((entry) => String(entry).endsWith('SKILL.md')), false);
    const noise = await readFile(path.join(destination, 'v4-new-features', 'topic.md'), 'utf8');
    assert.match(noise, /this\.add\.noisecell2d/);
    assert.match(noise, /this\.add\.noisesimplex3d/);
    assert.doesNotMatch(noise, /this\.add\.noiseCell2D/);
    const actions = await readFile(path.join(destination, 'actions-and-utilities', 'topic.md'), 'utf8');
    assert.match(actions, /^## Contents$/m);
    const reference = await readFile(path.join(destination, 'cameras', 'reference.md'), 'utf8');
    assert.match(reference, /\.\.\/animations\/topic\.md/);
    assert.match(reference, /`topic\.md`/);
  } finally {
    if (root.startsWith(os.tmpdir())) await rm(root, { recursive: true, force: true });
  }
});
