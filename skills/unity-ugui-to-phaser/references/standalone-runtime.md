# Standalone Runtime

## What Is Bundled

The skill is a complete project-independent converter distribution:

- `runtime/unity-ui-converter/src`: editable TypeScript converter source;
- `runtime/unity-ui-converter/dist`: prebuilt Node.js CLI and library modules;
- `runtime/unity-ui-converter/templates`: HTML and Phaser preview templates;
- `runtime/unity-ui-converter/vendor`: bundled YAML parser and Phaser browser runtime for offline conversion;
- `scripts/ugui.mjs`: stable entrypoint from any current directory;
- `scripts/setup.mjs`: isolated dependency installation and converter build;
- `scripts/doctor.mjs`: runtime, dependency, template, and browser checks;
- profiling, batch-audit, and render-comparison scripts;
- `package.json` and `package-lock.json`: pinned runtime and build dependencies.

The target project supplies only Unity inputs and an output location. It does not need to contain the converter source.

## External Runtime Requirements

- Node.js 20 or newer for conversion and baking;
- npm only for rebuilding TypeScript source or installing optional comparison tooling;
- filesystem access to the Unity project and output directory;
- Chrome, Edge, or Playwright Chromium only for PNG comparison.

The converter does not require the Unity Editor to parse and bake serialized Prefabs. Unity is still needed to create trustworthy ground-truth captures and runtime-state fixtures.

## First Use

Resolve the directory containing this file as `<skill-root>/references`, then use the parent as `<skill-root>`.

```bash
node "<skill-root>/scripts/ugui.mjs" doctor
node "<skill-root>/scripts/smoke-test.mjs"
```

Conversion and baking require no setup and can run offline. Use `setup` before rebuilding source. Use `setup --with-browser` when the machine has no suitable Chrome or Edge and pixel comparison is required.

The smoke test creates and removes its own temporary Unity project. Its default path verifies offline conversion without optional Playwright tooling. After setup, use `node "<skill-root>/scripts/smoke-test.mjs" --with-browser` to include the pixel comparator.

Setup installs development tools into `<skill-root>/node_modules`. It must not run npm install in the Unity project or the Phaser target project.

## Distribution

Copy the entire skill directory. Keep `SKILL.md`, `agents`, `references`, `scripts`, `runtime`, `package.json`, and `package-lock.json` together.

`node_modules` should normally be omitted. The bundled CLI, YAML parser, templates, and Phaser browser runtime are sufficient for offline conversion. Run setup after copying only when rebuilding source or using Playwright-based comparison. Copying `node_modules` is only appropriate for an offline transfer of development tooling between machines with compatible operating systems and CPU architectures.

For Codex project discovery, place the directory at:

```text
<target-project>/.agents/skills/unity-ugui-to-phaser/
```

For user-wide discovery, place it at:

```text
~/.agents/skills/unity-ugui-to-phaser/
```

## Command Reference

```bash
node "<skill-root>/scripts/ugui.mjs" help
node "<skill-root>/scripts/ugui.mjs" scan --project "<unity-project>"
node "<skill-root>/scripts/ugui.mjs" bake --project "<unity-project>" --prefab "<prefab>" --output "<directory>"
node "<skill-root>/scripts/ugui.mjs" batch --project "<unity-project>" --output-root "<directory>"
```

Optional project overrides:

- `--prefab-root <directory>`;
- `--ui-raw-root <directory>`;
- `--asset-roots <directory;directory>` to limit GUID indexing to explicitly approved roots;
- `--asset-index <json-file>`;
- `--reference-resolution <width>x<height>`;
- `--rebuild-index`.

When no Prefab root is supplied, the CLI checks `Assets/Resources/UI`, then `Assets/UI`, then uses the complete `Assets` tree. A missing default `Assets/UIRaw` directory is valid; an explicitly supplied missing directory is an error.

When `--asset-roots` is omitted, GUID indexing uses the complete Unity `Assets` tree. When it is supplied, the converter must not widen the search beyond those semicolon-separated directories. References outside the declared roots remain unresolved and must be reported rather than silently searched elsewhere.

## Source Changes

After editing `runtime/unity-ui-converter/src`, build and validate from the skill root:

```bash
npm run setup
npm run build:converter
npm run doctor
```

Commit source and generated `dist` together so a copied skill can execute before rebuilding.
