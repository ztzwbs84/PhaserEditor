#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') options.source = argv[++index];
    else if (arg === '--phaser-root') options.phaserRoot = argv[++index];
    else if (arg === '--destination') options.destination = argv[++index];
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node sync-official-skills.mjs --source <phaser-skills> --phaser-root <phaser-root> [--destination <dir>] [--json]',
    '',
    'The default destination is references/official/<installed-version>.',
  ].join('\n');
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertSafeDestination(destination) {
  const resolved = path.resolve(destination);
  const defaultParent = path.join(skillRoot, 'references', 'official');
  const tempParent = path.resolve(os.tmpdir());
  if (!isWithin(resolved, defaultParent) && !isWithin(resolved, tempParent)) {
    throw new Error(`Destination must stay under ${defaultParent} or ${tempParent}: ${resolved}`);
  }
  if (resolved === path.parse(resolved).root || resolved.length < 12) {
    throw new Error(`Refusing unsafe destination: ${resolved}`);
  }
}

function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
}

function githubSlug(heading) {
  return heading
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function addContents(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length <= 300 || /^## (?:Table of )?Contents\s*$/im.test(content)) return content;

  const headings = lines
    .filter((line) => /^## (?!Contents\s*$|Table of Contents\s*$)/.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim());
  if (headings.length < 2) return content;

  const firstSection = lines.findIndex((line) => /^##\s+/.test(line));
  if (firstSection < 0) return content;
  const toc = ['## Contents', '', ...headings.map((heading) => `- [${heading}](#${githubSlug(heading)})`), ''];
  lines.splice(firstSection, 0, ...toc);
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function transformLinks(content) {
  return content
    .replaceAll('references/REFERENCE..//SKILL.md', 'reference.md')
    .replaceAll('references/REFERENCE.md', 'reference.md')
    .replaceAll('../SKILL.md', 'topic.md')
    .replace(/\.\.\/([a-z0-9-]+)\/SKILL\.md/g, '../$1/topic.md');
}

function applyVersionCorrections(content, topic) {
  if (topic !== 'v4-new-features') return { content, corrections: [] };
  const replacements = new Map([
    ['noiseCell2D', 'noisecell2d'],
    ['noiseCell3D', 'noisecell3d'],
    ['noiseCell4D', 'noisecell4d'],
    ['noiseSimplex2D', 'noisesimplex2d'],
    ['noiseSimplex3D', 'noisesimplex3d'],
  ]);
  const corrections = [];
  let result = content;
  for (const [before, after] of replacements) {
    const pattern = new RegExp(`this\\.add\\.${before}\\b`, 'g');
    if (pattern.test(result)) corrections.push(`this.add.${before} -> this.add.${after}`);
    result = result.replace(pattern, `this.add.${after}`);
  }
  return { content: result, corrections };
}

function transform(content, topic, sourceRelative, sourceHash) {
  let transformed = stripFrontmatter(content);
  transformed = transformLinks(transformed);
  const corrected = applyVersionCorrections(transformed, topic);
  transformed = addContents(corrected.content);
  const provenance = [
    '<!--',
    `Vendored from Phaser 4.2.1 ${sourceRelative}.`,
    `Upstream SHA-256: ${sourceHash}.`,
    'This is an on-demand reference, not a separately registered skill.',
    '-->',
    '',
  ].join('\n');
  return { content: `${provenance}${transformed}`, corrections: corrected.corrections };
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.source || !options.phaserRoot) throw new Error(`--source and --phaser-root are required.\n${usage()}`);

  const sourceRoot = path.resolve(options.source);
  const phaserRoot = path.resolve(options.phaserRoot);
  const packageJson = JSON.parse(await readFile(path.join(phaserRoot, 'package.json'), 'utf8'));
  if (!String(packageJson.version).startsWith('4.')) {
    throw new Error(`Expected Phaser 4, found ${packageJson.version}`);
  }

  const destination = path.resolve(
    options.destination ?? path.join(skillRoot, 'references', 'official', packageJson.version),
  );
  assertSafeDestination(destination);

  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const topics = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await exists(path.join(sourceRoot, entry.name, 'SKILL.md'))) topics.push(entry.name);
  }
  topics.sort();
  if (topics.length !== 28) throw new Error(`Expected 28 official Phaser topics, found ${topics.length}`);

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  const manifestFiles = [];
  const allCorrections = [];
  for (const topic of topics) {
    const topicDestination = path.join(destination, topic);
    await mkdir(topicDestination, { recursive: true });

    const sourceSkill = path.join(sourceRoot, topic, 'SKILL.md');
    const sourceSkillContent = await readFile(sourceSkill, 'utf8');
    const sourceSkillHash = sha256(sourceSkillContent);
    const transformedSkill = transform(
      sourceSkillContent,
      topic,
      `skills/${topic}/SKILL.md`,
      sourceSkillHash,
    );
    const topicOutput = path.join(topicDestination, 'topic.md');
    await writeFile(topicOutput, transformedSkill.content, 'utf8');
    allCorrections.push(...transformedSkill.corrections.map((correction) => ({ topic, correction })));

    const record = {
      topic,
      sourceSkill: `skills/${topic}/SKILL.md`,
      sourceSkillSha256: sourceSkillHash,
      vendoredTopic: `${topic}/topic.md`,
      vendoredTopicSha256: sha256(transformedSkill.content),
    };

    const sourceReference = path.join(sourceRoot, topic, 'references', 'REFERENCE.md');
    if (await exists(sourceReference)) {
      const sourceReferenceContent = await readFile(sourceReference, 'utf8');
      const sourceReferenceHash = sha256(sourceReferenceContent);
      const transformedReference = transform(
        sourceReferenceContent,
        topic,
        `skills/${topic}/references/REFERENCE.md`,
        sourceReferenceHash,
      );
      const referenceOutput = path.join(topicDestination, 'reference.md');
      await writeFile(referenceOutput, transformedReference.content, 'utf8');
      record.sourceReference = `skills/${topic}/references/REFERENCE.md`;
      record.sourceReferenceSha256 = sourceReferenceHash;
      record.vendoredReference = `${topic}/reference.md`;
      record.vendoredReferenceSha256 = sha256(transformedReference.content);
    }
    manifestFiles.push(record);
  }

  const git = spawnSync('git', ['-C', phaserRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const gitCommit = git.status === 0 ? git.stdout.trim() : null;
  const manifest = {
    schemaVersion: 1,
    phaserVersion: packageJson.version,
    phaserRelease: packageJson.release ?? null,
    gitCommit,
    generatedAt: new Date().toISOString(),
    sourceDirectory: 'skills',
    topicCount: topics.length,
    entryPolicy: 'Only the root build-phaser-v4-games/SKILL.md is a skill entry; vendored topics are references.',
    corrections: allCorrections,
    files: manifestFiles,
  };
  await writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const readme = [
    `# Official Phaser ${packageJson.version} Topic References`,
    '',
    'These files are vendored, non-triggering references used by the single `build-phaser-v4-games` entry skill.',
    '',
    `- Release: ${packageJson.release ?? 'unknown'}`,
    `- Git commit: ${gitCommit ?? 'unavailable'}`,
    `- Topics: ${topics.length}`,
    '- Upstream and transformed hashes: `manifest.json`',
    '- Local fixes: `../../official-corrections-4.2.1.md`',
    '- Topic routing: `../../official-topic-index.md`',
    '',
    'Do not read all topics. Route to the smallest relevant set and verify exact APIs against the installed Phaser package.',
    '',
  ].join('\n');
  await writeFile(path.join(destination, 'README.md'), readme, 'utf8');

  const license = path.join(phaserRoot, 'LICENSE.md');
  if (await exists(license)) await copyFile(license, path.join(destination, 'LICENSE.md'));

  const result = {
    sourceRoot,
    destination,
    phaserVersion: packageJson.version,
    gitCommit,
    topics: topics.length,
    corrections: allCorrections.length,
  };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Vendored ${topics.length} Phaser ${packageJson.version} topics with ${allCorrections.length} API corrections into ${destination}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
