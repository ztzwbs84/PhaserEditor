import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const skillRoot = fileURLToPath(new URL('../', import.meta.url))
export const converterRoot = path.join(skillRoot, 'runtime', 'unity-ui-converter')
export const converterCli = path.join(converterRoot, 'dist', 'cli.js')
