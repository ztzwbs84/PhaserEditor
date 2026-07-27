import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(scriptDir, 'validate-integrated-skill.mjs');
const skillRoot = path.resolve(scriptDir, '..');

test('the packaged skill has one entry and a complete routed official reference set', async () => {
  const result = await execFileAsync(process.execPath, [script, '--skill-root', skillRoot, '--json']);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'pass');
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.checks.find((check) => check.name === 'single-entry').value, 1);
  assert.equal(report.summary.checks.find((check) => check.name === 'official-topics').value, 28);
});
