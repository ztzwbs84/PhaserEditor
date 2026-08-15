# __GAME_TITLE_HTML__

Carry embers from the central hearth to the matching edge beacon before their heat expires. Avoid roaming wisps, build a delivery streak, and keep the flame alive.

```bash
npm ci
npm run check
npm run dev
```

`npm run check` runs TypeScript, domain and gate tests, a production build, real gzip budgets, desktop/mobile Chromium E2E, the strict Phaser audit, and API anchors. It refreshes all six reports/screenshots in `.quality/` and removes stale browser/audit/API evidence when a gate fails. Set `PHASER_BROWSER_PATH` when Chrome or Edge is outside a standard location.
