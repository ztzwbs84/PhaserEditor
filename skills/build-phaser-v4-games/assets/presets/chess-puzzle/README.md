# __GAME_TITLE_HTML__

Solve three checkmate-in-one positions while preserving your limited attempts. Legal moves and checkmate are validated by chess.js; Phaser owns presentation and input only.

```bash
npm ci
npm run check
npm run dev
```

`npm run check` runs strict TypeScript, domain and gate tests, a production build, gzip budgets, desktop/mobile Chromium E2E, the strict Phaser audit, and API anchors. It refreshes all six reports/screenshots in `.quality/` and removes stale browser/audit/API evidence when a gate fails. Set `PHASER_BROWSER_PATH` when Chrome or Edge is outside a standard location.
