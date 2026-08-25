# Phaser 4 to WeChat Mini Game

One-shot converter for Vite Phaser 4 JavaScript and TypeScript projects. The source project is analyzed and bundled into a separate WeChat Mini Game directory; source files are never copied into or rewritten by the converter.

## Usage

From the PhaserEditor repository root:

```bash
npm run wechat:patch
npm run wechat:patch -- --project "I:\\Phaser\\MyGame"
npm run wechat:patch -- --project "I:\\Phaser\\MyGame" --output "I:\\Output\\MyGame-wechat"
```

Run `npm run wechat:patch -- --help` for all flags. Without `--project`, the CLI prompts for a path when stdin is interactive.

The generated directory uses the same synchronous startup order as the verified Phaser 4 Mini Game sample: `game.js` loads `js/weapp-adapter.js`, then the installed Phaser UMD copy at `js/phaser.js`, and finally the Phaser-externalized `js/game.bundle.js`. It also contains WeChat project files, copied public assets, URI-encoded asset aliases, optional storage/audio/Spine helpers, `.wechat-patch-manifest.json`, and `conversion-report.json`.

## Exit Codes

- `0`: output generated and every detected `Phaser.Game` was converted.
- `2`: output generated with a warning that can affect running or uploading it.
- `1`: dependency installation, analysis, build, publication, or syntax validation failed.

Repeated runs delete only files listed in the prior manifest. Existing AppID, `project.private.config.json`, and unmanaged files are preserved.
