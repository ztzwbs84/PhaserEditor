#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte']);
const SKIP_DIRECTORIES = new Set([
  '.git', '.idea', '.next', '.nuxt', '.output', '.turbo', '.vite', '.vscode',
  'build', 'coverage', 'dist', 'node_modules', 'out', 'public', 'vendor',
]);
const LEVEL_ORDER = { error: 0, warning: 1, info: 2 };
const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 };

function parseArguments(argv) {
  const options = { root: null, json: false, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!options.root) options.root = path.resolve(arg);
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  options.root ??= process.cwd();
  return options;
}

function printHelp() {
  console.log(`Usage: node audit-phaser-project.mjs [project-root] [options]

Heuristically audit a Phaser project for v4 migration, lifecycle, renderer,
loading, hot-loop, physics ownership, and render-texture risks.

Options:
  --json     Print machine-readable JSON
  --strict   Fail when warnings are present
  -h, --help Show this help`);
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot parse ${file}: ${error.message}`);
  }
}

async function collectSources(root, current = root, output = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        await collectSources(root, path.join(current, entry.name), output);
      }
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      output.push(path.join(current, entry.name));
    }
  }
  return output;
}

function sanitizeSource(text, preserveStrings) {
  let state = 'code';
  let quote = '';
  let escaped = false;
  let output = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code';
        output += '\n';
      } else output += ' ';
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        output += '  ';
        index += 1;
        state = 'code';
      } else output += char === '\n' ? '\n' : ' ';
      continue;
    }

    if (state === 'string') {
      if (preserveStrings) output += char;
      else output += char === '\n' ? '\n' : ' ';

      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) {
        state = 'code';
        quote = '';
      }
      continue;
    }

    if (char === '/' && next === '/') {
      output += '  ';
      index += 1;
      state = 'line-comment';
    } else if (char === '/' && next === '*') {
      output += '  ';
      index += 1;
      state = 'block-comment';
    } else if (char === '"' || char === "'" || char === '`') {
      state = 'string';
      quote = char;
      escaped = false;
      output += preserveStrings ? char : ' ';
    } else output += char;
  }

  return output;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function relativePath(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function isPhaserSource(codeWithStrings) {
  return /(?:from\s*['"]phaser['"]|require\s*\(\s*['"]phaser['"]\s*\)|\bPhaser\.|extends\s+(?:Phaser\.)?Scene\b)/.test(codeWithStrings);
}

function addFinding(findings, root, file, original, index, finding) {
  findings.push({
    level: finding.level,
    confidence: finding.confidence,
    rule: finding.rule,
    file: relativePath(root, file),
    line: lineNumberAt(original, Math.max(0, index)),
    message: finding.message,
    suggestion: finding.suggestion,
  });
}

function addRuleMatches(findings, root, file, original, code, rule) {
  const regex = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
  for (const match of code.matchAll(regex)) {
    addFinding(findings, root, file, original, match.index, rule);
  }
}

const MIGRATION_RULES = [
  {
    level: 'error', confidence: 'high', rule: 'v3-pipeline-api',
    pattern: /(?:\.setPipeline\s*\(|Phaser\.Renderer\.WebGL\.Pipelines\b)/g,
    message: 'Phaser 3 Pipeline API is present in a Phaser 4 code path.',
    suggestion: 'Replace it with a higher-level v4 Shader/Filter API or a source-verified RenderNode extension.',
  },
  {
    level: 'error', confidence: 'high', rule: 'v3-fx-api',
    pattern: /\.(?:preFX|postFX)\b/g,
    message: 'Phaser 3 preFX/postFX usage is incompatible with the Phaser 4 filter model.',
    suggestion: 'Call enableFilters() and use filters.internal or filters.external as appropriate.',
  },
  {
    level: 'error', confidence: 'high', rule: 'v3-bitmap-mask',
    pattern: /Phaser\.Display\.Masks\.BitmapMask\b/g,
    message: 'BitmapMask was removed from the Phaser 4 WebGL path.',
    suggestion: 'Use the Phaser 4 Mask filter and verify Canvas requirements separately.',
  },
  {
    level: 'error', confidence: 'high', rule: 'v3-tint-fill',
    pattern: /\.setTintFill\s*\(/g,
    message: 'setTintFill was removed in Phaser 4.',
    suggestion: 'Use setTint(color).setTintMode(Phaser.TintModes.FILL).',
  },
  {
    level: 'error', confidence: 'high', rule: 'v3-geom-point',
    pattern: /Phaser\.Geom\.Point\b/g,
    message: 'Phaser.Geom.Point was removed in Phaser 4.',
    suggestion: 'Use Phaser.Math.Vector2 and verify helper replacements.',
  },
  {
    level: 'error', confidence: 'high', rule: 'v3-math-pi2',
    pattern: /Phaser\.Math\.PI2\b/g,
    message: 'Phaser.Math.PI2 was removed in Phaser 4.',
    suggestion: 'Use Phaser.Math.TAU and verify old TAU assumptions because its semantics changed.',
  },
  {
    level: 'warning', confidence: 'high', rule: 'v3-struct-collection',
    pattern: /Phaser\.Structs?\.(?:Set|Map)\b/g,
    message: 'Legacy Phaser Set/Map collection usage was found.',
    suggestion: 'Use native Set or Map and verify iteration/return-value differences.',
  },
  {
    level: 'error', confidence: 'high', rule: 'v3-mesh-plane',
    pattern: /(?:this\.add\.(?:mesh|plane)\s*\(|Phaser\.GameObjects\.(?:Mesh|Plane)\b)/g,
    message: 'Mesh or Plane Game Object usage was found; these were removed in Phaser 4.',
    suggestion: 'Redesign with a v4 Shader/Game Object/RenderNode or a maintained 3D integration.',
  },
  {
    level: 'error', confidence: 'high', rule: 'v3-generate-texture',
    pattern: /(?:Phaser\.Create\.GenerateTexture|\.textures\.generate\s*\()/g,
    message: 'A removed Phaser 3 texture-generation API was found.',
    suggestion: 'Use Graphics, DynamicTexture, or RenderTexture with the v4 command-buffer workflow.',
  },
];

const API_RULES = [
  {
    level: 'error', confidence: 'high', rule: 'custom-context-factory-casing',
    pattern: /this\.add\.customContext\s*\(/g,
    message: 'Phaser 4.2.1 declares this.add.customContext, but the runtime factory is registered as customcontext.',
    suggestion: 'Prefer this.make.customContext(config, true), whose declaration and runtime registration agree.',
  },
  {
    level: 'error', confidence: 'high', rule: 'custom-context-creator-casing',
    pattern: /this\.make\.customcontext\s*\(/g,
    message: 'The CustomContext creator is registered as camel-case customContext.',
    suggestion: 'Use this.make.customContext(config, true) and require WebGL.',
  },
  {
    level: 'error', confidence: 'high', rule: 'mesh2d-factory-casing',
    pattern: /this\.add\.mesh2D\s*\(/g,
    message: 'The Phaser 4.2 Mesh2D factory is registered as lowercase mesh2d.',
    suggestion: 'Use this.add.mesh2d(x, y, texture, vertices, indices, flipV).',
  },
  {
    level: 'error', confidence: 'high', rule: 'stencil-reference-factory-casing',
    pattern: /this\.(?:add|make)\.stencilReference\s*\(/g,
    message: 'The Phaser 4.2 StencilReference factory and creator are registered as lowercase stencilreference.',
    suggestion: 'Use this.add.stencilreference(...) or this.make.stencilreference(...).',
  },
  {
    level: 'error', confidence: 'high', rule: 'noise-factory-casing',
    pattern: /this\.(?:add|make)\.(?:noiseCell2D|noiseCell3D|noiseCell4D|noiseSimplex2D|noiseSimplex3D)\s*\(/g,
    message: 'Phaser 4 Noise factories are registered with lowercase names.',
    suggestion: 'Use noisecell2d/noisecell3d/noisecell4d/noisesimplex2d/noisesimplex3d exactly as declared and registered.',
  },
  {
    level: 'warning', confidence: 'high', rule: 'direct-fps-limit-mutation',
    pattern: /\.loop\.fpsLimit\s*=/g,
    message: 'Direct TimeStep fpsLimit mutation can leave derived timing values stale.',
    suggestion: 'On Phaser 4.2+, call game.loop.setFPSLimit(limit).',
  },
];

function findMatchingBrace(code, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < code.length; index += 1) {
    if (code[index] === '{') depth += 1;
    else if (code[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findMethodBodies(code, name) {
  const patterns = [
    new RegExp(`(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`, 'g'),
    new RegExp(`${name}\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{`, 'g'),
  ];
  const bodies = [];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const open = code.indexOf('{', match.index);
      const close = findMatchingBrace(code, open);
      if (close > open) bodies.push({ start: match.index, bodyStart: open + 1, end: close, text: code.slice(open + 1, close) });
    }
  }
  return bodies;
}

function inspectHotLoops(findings, root, file, original, code) {
  for (const method of findMethodBodies(code, 'update')) {
    const allocation = method.text.match(/(?:this\.add\.[A-Za-z_$][\w$]*\s*\(|new\s+(?:Phaser\.|Array\b|Map\b|Set\b))/);
    if (allocation) {
      addFinding(findings, root, file, original, method.bodyStart + allocation.index, {
        level: 'warning', confidence: 'medium', rule: 'hot-update-allocation',
        message: 'A Scene update method appears to allocate a Game Object or collection.',
        suggestion: 'Construct outside the hot loop or pool only after measuring; inspect this exact update path.',
      });
    }

    const raster = method.text.match(/\.(?:setText|setStyle|setFont|setFontSize|updateText)\s*\(/);
    if (raster) {
      addFinding(findings, root, file, original, method.bodyStart + raster.index, {
        level: 'info', confidence: 'medium', rule: 'hot-update-text-rasterization',
        message: 'Text/style mutation appears inside Scene update and may rerasterize or upload every frame.',
        suggestion: 'Skip unchanged values, coalesce updates, or use BitmapText for frequently changing labels.',
      });
    }

    const load = method.text.match(/this\.load\.[A-Za-z_$][\w$]*\s*\(/);
    if (load) {
      addFinding(findings, root, file, original, method.bodyStart + load.index, {
        level: 'warning', confidence: 'high', rule: 'load-inside-update',
        message: 'A Loader request appears inside Scene update.',
        suggestion: 'Move loading to a controlled milestone; do not enqueue the same asset every frame.',
      });
    }
  }
}

function inspectLoading(findings, root, file, original, code) {
  if (/this\.load\.start\s*\(/.test(code)) return;
  for (const methodName of ['create', 'update']) {
    for (const method of findMethodBodies(code, methodName)) {
      const match = method.text.match(/this\.load\.(?!start\b|set[A-Z]|on\b|once\b|off\b)[A-Za-z_$][\w$]*\s*\(/);
      if (match) {
        addFinding(findings, root, file, original, method.bodyStart + match.index, {
          level: 'warning', confidence: 'medium', rule: 'loader-outside-preload-without-start',
          message: `A Loader request appears in ${methodName} without a visible this.load.start() in the same file.`,
          suggestion: 'Start and await the Loader explicitly outside preload, or move the request into preload.',
        });
      }
    }
  }
}

function inspectListenerOwnership(findings, root, file, original, code) {
  const pairs = [
    { add: /this\.game\.events\.on\s*\(/g, remove: /this\.game\.events\.off\s*\(/, rule: 'game-event-lifecycle', label: 'game.events' },
    { add: /this\.registry\.events\.on\s*\(/g, remove: /this\.registry\.events\.off\s*\(/, rule: 'registry-event-lifecycle', label: 'registry.events' },
    { add: /(?:window|document)\.addEventListener\s*\(/g, remove: /(?:window|document)\.removeEventListener\s*\(/, rule: 'dom-event-lifecycle', label: 'DOM' },
  ];

  for (const pair of pairs) {
    if (pair.remove.test(code)) continue;
    for (const match of code.matchAll(pair.add)) {
      addFinding(findings, root, file, original, match.index, {
        level: 'warning', confidence: 'medium', rule: pair.rule,
        message: `${pair.label} listener has no matching removal visible in the same file.`,
        suggestion: 'Remove it with the same callback/context on Scene SHUTDOWN or the actual owner boundary.',
      });
    }
  }
}

function inspectRenderTextures(findings, root, file, original, code) {
  const constructors = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:this\.(?:add|make)\.renderTexture\s*\(|this\.textures\.addDynamicTexture\s*\(|new\s+Phaser\.Textures\.DynamicTexture\s*\()/g;
  for (const match of code.matchAll(constructors)) {
    const id = match[1];
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const draw = new RegExp(`\\b${escaped}\\.(?:draw|capture|stamp|repeat|fill|erase|clear)\\s*\\(`).exec(code);
    const render = new RegExp(`\\b${escaped}\\.render\\s*\\(`).test(code);
    if (draw && !render) {
      addFinding(findings, root, file, original, draw.index, {
        level: 'warning', confidence: 'medium', rule: 'render-texture-command-not-rendered',
        message: `${id} buffers drawing commands but has no visible render() call in the same file.`,
        suggestion: 'Execute the v4 command buffer with render() or verify an intentional RenderTexture renderMode.',
      });
    }
  }
}

function inspectPhysicsOwnership(findings, root, file, original, code) {
  const arcade = new Set([...code.matchAll(/this\.physics\.add\.existing\s*\(\s*([A-Za-z_$][\w$]*)/g)].map((match) => match[1]));
  const matter = new Set([...code.matchAll(/this\.matter\.add\.gameObject\s*\(\s*([A-Za-z_$][\w$]*)/g)].map((match) => match[1]));
  for (const id of arcade) {
    if (matter.has(id)) {
      const index = code.indexOf(`this.matter.add.gameObject(${id}`);
      addFinding(findings, root, file, original, index, {
        level: 'error', confidence: 'high', rule: 'dual-physics-body',
        message: `${id} appears to be attached to both Arcade and Matter physics.`,
        suggestion: 'Choose one physics authority for this object and bridge systems through domain events.',
      });
    }
  }
}

function inspectGpuTilemapEdits(findings, root, file, original, code) {
  const gpu = /TilemapGPULayer\b|\.createLayer\s*\([^;\n]*,\s*true\s*\)/.test(code);
  const edit = /\.(?:putTileAt|putTilesAt|removeTileAt|replaceByIndex|randomize|shuffle|swapByIndex)\s*\(/.exec(code);
  if (gpu && edit && !/\.generateLayerDataTexture\s*\(/.test(code)) {
    addFinding(findings, root, file, original, edit.index, {
      level: 'warning', confidence: 'medium', rule: 'gpu-tilemap-stale-data',
      message: 'A GPU Tilemap layer appears to be edited without regenerating its layer data texture.',
      suggestion: 'Call the owning TilemapGPULayer.generateLayerDataTexture() after edits, or use a CPU layer for frequent edits.',
    });
  }
}

function inspectAccessibility(findings, root, file, original, code) {
  const interactive = /\.setInteractive\s*\(|\.on\s*\(\s*['"]pointer(?:down|up)['"]/.exec(code);
  if (!interactive) return;
  const alternative = /(?:\.keyboard\b|\.gamepad\b|keydown|keyup|aria-|role\s*=|DOMElement|createElement)/i.test(code);
  if (!alternative) {
    addFinding(findings, root, file, original, interactive.index, {
      level: 'info', confidence: 'low', rule: 'interactive-accessibility-review',
      message: 'A pointer-interactive control has no keyboard/gamepad/semantic DOM alternative visible locally.',
      suggestion: 'Review the complete component and provide focus, activation parity, labels, and DOM semantics where critical.',
    });
  }
}

function dependencyValue(packageJson, name) {
  return packageJson.dependencies?.[name]
    ?? packageJson.devDependencies?.[name]
    ?? packageJson.peerDependencies?.[name]
    ?? null;
}

function majorFromVersion(value) {
  return String(value ?? '').match(/(?:^|[^0-9])(\d+)/)?.[1] ?? null;
}

function projectFinding(findings, level, confidence, rule, message, suggestion, file = 'package.json') {
  findings.push({ level, confidence, rule, file, line: 1, message, suggestion });
}

export async function audit(projectRoot) {
  const root = path.resolve(projectRoot);
  const packageFile = path.join(root, 'package.json');
  if (!(await exists(packageFile))) throw new Error(`No package.json found at ${packageFile}`);

  const packageJson = await readJson(packageFile);
  const installedFile = path.join(root, 'node_modules', 'phaser', 'package.json');
  const installed = (await exists(installedFile)) ? await readJson(installedFile) : null;
  const declared = dependencyValue(packageJson, 'phaser');
  const findings = [];

  if (!declared && !installed) {
    projectFinding(findings, 'warning', 'medium', 'missing-phaser-dependency',
      'No declared or installed phaser package was found.',
      'Confirm this is a Phaser project or install/declare Phaser explicitly.');
  }

  const effectiveVersion = installed?.version ?? declared;
  const major = majorFromVersion(effectiveVersion);
  if (major && major !== '4') {
    projectFinding(findings, 'error', 'high', 'unsupported-phaser-major',
      `Detected Phaser ${effectiveVersion}; this skill targets Phaser 4.`,
      'Use the v3-to-v4 migration workflow or a version-matched skill.');
  }

  const sourceFiles = await collectSources(root);
  const phaserFiles = [];
  let combinedCode = '';

  for (const file of sourceFiles) {
    const original = await readFile(file, 'utf8');
    const withStrings = sanitizeSource(original, true);
    if (!isPhaserSource(withStrings)) continue;

    const code = sanitizeSource(original, false);
    phaserFiles.push(file);
    combinedCode += `\n${code}`;

    for (const rule of MIGRATION_RULES) addRuleMatches(findings, root, file, original, code, rule);
    for (const rule of API_RULES) addRuleMatches(findings, root, file, original, code, rule);
    inspectHotLoops(findings, root, file, original, code);
    inspectLoading(findings, root, file, original, code);
    inspectListenerOwnership(findings, root, file, original, code);
    inspectRenderTextures(findings, root, file, original, code);
    inspectPhysicsOwnership(findings, root, file, original, code);
    inspectGpuTilemapEdits(findings, root, file, original, code);
    inspectAccessibility(findings, root, file, original, withStrings);
  }

  const webglFeatures = /(?:\.enableFilters\s*\(|\.setLighting\s*\(|SpriteGPULayer\b|TilemapGPULayer\b|RenderNode\b|CustomContext\b|Mesh2D\b|Stencil(?:Reference)?\b|this\.(?:add|make)\.(?:customcontext|customContext|mesh2d|stencil|stencilreference)\s*\()/.test(combinedCode);
  if (webglFeatures) {
    if (/Phaser\.CANVAS\b/.test(combinedCode)) {
      projectFinding(findings, 'error', 'medium', 'canvas-webgl-feature-conflict',
        'The project references Phaser.CANVAS and a WebGL-only Phaser 4 feature.',
        'Force WebGL for that product path or implement and test a Canvas feature gate/fallback.');
    } else if (!/Phaser\.WEBGL\b/.test(combinedCode)) {
      projectFinding(findings, 'warning', 'medium', 'implicit-auto-with-webgl-features',
        'WebGL-only Phaser 4 features are present without a visible explicit Phaser.WEBGL renderer decision.',
        'Confirm GameConfig cannot fall back to Canvas, or gate every WebGL-only feature.');
    }
  }

  const stencilFeatures = /(?:\bStencil(?:Reference)?\b|this\.(?:add|make)\.(?:stencil|stencilreference)\s*\()/.test(combinedCode);
  if (stencilFeatures && /\bstencil\s*:\s*false\b/.test(combinedCode)) {
    projectFinding(findings, 'error', 'high', 'stencil-buffer-disabled',
      'Stencil Game Objects are present while render.stencil is explicitly false.',
      'Enable the WebGL stencil buffer or replace the feature with a supported Filter/composition design.');
  }

  findings.sort((left, right) =>
    LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level]
      || CONFIDENCE_ORDER[left.confidence] - CONFIDENCE_ORDER[right.confidence]
      || left.file.localeCompare(right.file)
      || left.line - right.line);

  const summary = findings.reduce((result, finding) => {
    result[finding.level] += 1;
    return result;
  }, { error: 0, warning: 0, info: 0 });

  return {
    projectRoot: root,
    declaredPhaser: declared,
    installedPhaser: installed?.version ?? null,
    sourceFiles: sourceFiles.length,
    phaserSourceFiles: phaserFiles.length,
    summary,
    findings,
  };
}

function printText(report) {
  console.log('Phaser project audit');
  console.log(`Root:      ${report.projectRoot}`);
  console.log(`Phaser:    ${report.installedPhaser ?? report.declaredPhaser ?? '<not found>'}`);
  console.log(`Sources:   ${report.phaserSourceFiles}/${report.sourceFiles} Phaser-related`);
  console.log(`Findings:  ${report.summary.error} errors, ${report.summary.warning} warnings, ${report.summary.info} info`);

  for (const finding of report.findings) {
    console.log(`\n[${finding.level.toUpperCase()}] ${finding.rule} (${finding.confidence})`);
    console.log(`  ${finding.file}:${finding.line} ${finding.message}`);
    console.log(`  ${finding.suggestion}`);
  }
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    const report = await audit(options.root);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printText(report);
    if (report.summary.error > 0 || (options.strict && report.summary.warning > 0)) process.exitCode = 1;
  } catch (error) {
    if (options?.json) console.log(JSON.stringify({ error: error.message }, null, 2));
    else console.error(`Audit failed: ${error.message}`);
    process.exitCode = 2;
  }
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) await main();
