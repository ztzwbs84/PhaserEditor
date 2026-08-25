export type Orientation = 'portrait' | 'landscape'

export interface CliOptions {
  project?: string
  output?: string
  width?: number
  height?: number
  orientation?: Orientation
  appid?: string
  install: boolean
  force: boolean
  dryRun: boolean
  json: boolean
  help: boolean
}

export interface ConversionOptions extends Omit<CliOptions, 'project' | 'help'> {
  project: string
}

export interface Diagnostic {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  runtimeImpact: boolean
  file?: string
}

export interface GameSite {
  file: string
  line: number
  column: number
  constructorText: string
  configText: string | null
  width?: number
  height?: number
}

export interface SourceAnalysis {
  files: string[]
  gameSites: GameSite[]
  cssImports: string[]
  assetReferences: string[]
  networkApis: string[]
  browserGlobals: string[]
}

export interface ProjectAnalysis {
  projectRoot: string
  packageJsonPath: string
  packageName: string
  indexHtmlPath: string
  entryPath: string
  viteConfigPath?: string
  phaserVersion: string
  source: SourceAnalysis
  inferredWidth?: number
  inferredHeight?: number
  diagnostics: Diagnostic[]
}

export interface BuildResult {
  directory: string
  bundlePath: string
  transformedGames: number
  removedCssImports: string[]
  rewrittenAssets: string[]
}

export interface FileSummary {
  path: string
  sha256: string
  bytes: number
}

export interface PatchManifest {
  schemaVersion: 1
  generator: string
  generatedAt: string
  generatedFiles: string[]
  sourceProject: string
  sourceEntry: string
  phaserVersion: string
  parameters: {
    width: number
    height: number
    orientation: Orientation
  }
  sourceFiles: FileSummary[]
}

export interface ConversionReport {
  schemaVersion: 1
  generatedAt: string
  sourceProject: string
  outputProject: string
  sourceEntry?: string
  phaserVersion?: string
  runnable: boolean
  dryRun: boolean
  width: number
  height: number
  orientation: Orientation
  appid: string
  gameCount: number
  transformedGameCount: number
  generatedFiles: string[]
  packageBytes: number
  diagnostics: Diagnostic[]
  manualChecklist: string[]
}

export interface ConversionOutcome {
  exitCode: 0 | 1 | 2
  report: ConversionReport
}
