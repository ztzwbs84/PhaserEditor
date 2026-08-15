# __GAME_TITLE_HTML__

Pilot a compact interceptor, fire with pointer, touch, or Space, and destroy descending raiders before they breach the defense line.

```bash
npm ci
npm run check
npm run dev
```

`npm run check` runs strict TypeScript, domain and gate tests, a production build, gzip budgets, desktop/mobile Chromium E2E, the strict Phaser audit, and API anchors. It refreshes all six reports/screenshots in `.quality/` and removes stale browser/audit/API evidence when a gate fails. Set `PHASER_BROWSER_PATH` when Chrome or Edge is outside a standard location.
