# Bundled Runtime Dependencies

This directory contains runtime files required for project-independent and offline conversion.

- `js-yaml.mjs` and its source map: js-yaml 4.3.0 ESM distribution used to parse Unity YAML and `.meta` files.
- `phaser.js`: Phaser 4.2.1 minified browser distribution copied into baked previews.
- `licenses/`: upstream license texts retained with the redistributed files.

Update the version declarations in the standalone skill package and rerun its smoke test whenever these files change.
