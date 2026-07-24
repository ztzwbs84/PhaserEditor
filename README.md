# Phaser Editor

Desktop editor for local Phaser 4 projects, built with Electron, React and TypeScript.

## Development

```bash
npm install
npm run dev
```

For fast UI acceptance without launching Electron, start the browser harness:

```bash
npm run dev:web
```

Open `http://127.0.0.1:4174`. Development-only in-memory project and filesystem services exercise the same renderer, docking layout, editors and viewers without enabling Node access in the browser. Use this mode for responsive screenshots and visual regression checks; use Electron for the final preload, IPC, runner and embedded preview smoke test.

Production verification:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The development reference source is `I:\Phaser\phaser` (Phaser 4.2.1). Generated projects use the published `phaser@4.2.1` package and do not depend on that absolute path.

## Security model

- Renderer processes run with `contextIsolation`, sandboxing and no Node integration.
- Filesystem access is constrained to the active project root.
- Saves use temporary-file replacement and external modification checks.
- Project scripts require trust before first execution.
- Built-in preview navigation is restricted to localhost addresses.
- Plugins are local trusted extensions with manifest-declared permissions and a utility-process host.

## Current compatibility

- Windows is the primary packaged target.
- Tiled editing supports finite orthogonal JSON maps and embedded or external JSON tilesets.
- Infinite, isometric, staggered, hexagonal, compressed and TSX-backed maps open read-only.
