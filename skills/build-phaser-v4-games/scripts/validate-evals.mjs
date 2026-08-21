#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  throw new Error(message);
}

const evals = JSON.parse(await readFile(path.join(root, 'evals', 'evals.json'), 'utf8'));
if (evals.skill_name !== 'build-phaser-v4-games') fail('evals.skill_name does not match the skill');
if (!Array.isArray(evals.evals) || evals.evals.length < 10) fail('At least 10 capability evals are required');

const ids = new Set();
let atomicExpectationCount = 0;
for (const item of evals.evals) {
  if (!Number.isInteger(item.id) || ids.has(item.id)) fail(`Invalid or duplicate eval id: ${item.id}`);
  ids.add(item.id);
  if (typeof item.prompt !== 'string' || item.prompt.length < 80) fail(`Eval ${item.id} prompt is not realistic enough`);
  if (typeof item.expected_output !== 'string' || item.expected_output.length < 40) fail(`Eval ${item.id} lacks expected_output`);
  if (!Array.isArray(item.files)) fail(`Eval ${item.id} files must be an array`);
  if (!Array.isArray(item.expectations) || item.expectations.length < 4) fail(`Eval ${item.id} needs at least four expectations`);
  if (item.expectations.some((value) => typeof value !== 'string' || value.length < 20)) fail(`Eval ${item.id} has a weak expectation`);
  const compound = item.expectations.find((value) => /\b(?:and|or)\b/i.test(value));
  if (compound) fail(`Eval ${item.id} has a compound expectation: ${compound}`);
  atomicExpectationCount += item.expectations.length;
}

const gameUiEval = evals.evals.find((item) => item.prompt.includes('untrimmed 96x96 RGBA panel texture'));
if (!gameUiEval) fail('A realistic game-native UI and nine-slice capability eval is required');
for (const evidence of [
  'inside the Phaser canvas',
  'Phaser NineSlice',
  'setSize',
  'trimmed atlas frames',
  'slice manifest',
  'size previews',
  'desktop canvas UI crops',
  'semantic DOM controls',
]) {
  if (!gameUiEval.expectations.some((expectation) => expectation.includes(evidence))) {
    fail(`Game UI eval does not require ${evidence}`);
  }
}

if (atomicExpectationCount < 150) fail('At least 150 atomic capability expectations are required');

const triggers = JSON.parse(await readFile(path.join(root, 'evals', 'trigger-evals.json'), 'utf8'));
if (!Array.isArray(triggers) || triggers.length < 20) fail('At least 20 trigger evals are required');
const positive = triggers.filter((item) => item.should_trigger === true).length;
const negative = triggers.filter((item) => item.should_trigger === false).length;
if (positive < 8 || negative < 8) fail('Trigger evals need at least eight positive and eight negative cases');
if (triggers.some((item) => typeof item.query !== 'string' || item.query.length < 60)) fail('Trigger queries must be realistic and detailed');
if (triggers.some((item) => typeof item.should_trigger !== 'boolean')) fail('Every trigger query needs a boolean should_trigger');
if (!triggers.some((item) => item.should_trigger === true && item.query.includes('game-native Canvas UI'))) {
  fail('Trigger evals need a positive Phaser game UI case');
}
if (!triggers.some((item) => item.should_trigger === false && item.query.includes('standalone PNG'))) {
  fail('Trigger evals need a negative engine-independent image slicing case');
}

const routing = JSON.parse(await readFile(path.join(root, 'evals', 'routing-evals.json'), 'utf8'));
if (routing.skill_name !== 'build-phaser-v4-games') fail('routing-evals.skill_name does not match the skill');
if (routing.phaser_version !== '4.2.1') fail('routing-evals.phaser_version must match the vendored baseline');
if (!Array.isArray(routing.evals)) fail('routing-evals.evals must be an array');

const manifest = JSON.parse(await readFile(path.join(root, 'references', 'official', '4.2.1', 'manifest.json'), 'utf8'));
const manifestTopics = new Set(manifest.files.map((item) => item.topic));
const routedTopics = new Set();
for (const item of routing.evals) {
  if (!manifestTopics.has(item.topic)) fail(`Unknown routed topic: ${item.topic}`);
  if (routedTopics.has(item.topic)) fail(`Duplicate routed topic: ${item.topic}`);
  routedTopics.add(item.topic);
  if (typeof item.query !== 'string' || item.query.length < 80) fail(`Routing query for ${item.topic} is not realistic enough`);
  if (!Array.isArray(item.core_references) || item.core_references.length < 1) fail(`Routing eval ${item.topic} needs a core reference`);
  for (const reference of item.core_references) {
    await readFile(path.join(root, 'references', reference), 'utf8');
  }
}
for (const topic of manifestTopics) {
  if (!routedTopics.has(topic)) fail(`Official topic lacks a routing eval: ${topic}`);
}
const spriteRoute = routing.evals.find((item) => item.topic === 'sprites-and-images');
if (!spriteRoute?.core_references.includes('game-ui-nine-slice.md')) {
  fail('Sprites and images routing must include the game UI nine-slice reference');
}

console.log(`Validated ${evals.evals.length} capability evals with ${atomicExpectationCount} atomic expectations, ${routing.evals.length} routing evals, and ${triggers.length} trigger evals (${positive} positive, ${negative} negative).`);
