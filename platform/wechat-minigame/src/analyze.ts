import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import type { Diagnostic, GameSite, ProjectAnalysis, SourceAnalysis } from './types.js'

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cts',
  'vite.config.cjs'
]

interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export async function analyzeProject(projectValue: string): Promise<ProjectAnalysis> {
  const projectRoot = path.resolve(projectValue)
  const packageJsonPath = path.join(projectRoot, 'package.json')
  const indexHtmlPath = path.join(projectRoot, 'index.html')
  const packageJson = await readJson<PackageJson>(packageJsonPath, 'package.json')
  const indexHtml = await readFile(indexHtmlPath, 'utf8').catch(() => {
    throw new Error(`Vite entry page not found: ${indexHtmlPath}`)
  })
  const entryPath = await discoverHtmlEntry(projectRoot, indexHtml)
  const viteConfigs = await existingPaths(projectRoot, VITE_CONFIG_NAMES)
  const viteConfigPath = viteConfigs[0]
  const phaserVersion = await resolvePhaserVersion(projectRoot, packageJson)
  if (!/^4\./.test(phaserVersion)) {
    throw new Error(`Only Phaser 4 projects are supported. Detected Phaser ${phaserVersion}.`)
  }

  const diagnostics: Diagnostic[] = []
  if (!viteConfigPath) {
    diagnostics.push({
      code: 'VITE_CONFIG_MISSING',
      severity: 'warning',
      message: 'No Vite config file was found; Vite defaults will be used.',
      runtimeImpact: false
    })
  }
  if (viteConfigs.length > 1) {
    diagnostics.push({
      code: 'MULTIPLE_VITE_CONFIGS',
      severity: 'warning',
      message: `Multiple Vite configs were found; using ${path.basename(viteConfigPath!)}.`,
      runtimeImpact: false
    })
  }

  const source = await analyzeSourceGraph(projectRoot, entryPath)
  if (source.gameSites.length === 0) {
    diagnostics.push({
      code: 'GAME_CREATION_NOT_FOUND',
      severity: 'warning',
      message: 'No supported new Phaser.Game(...) expression was found.',
      runtimeImpact: true
    })
  } else if (source.gameSites.length > 1) {
    diagnostics.push({
      code: 'MULTIPLE_GAMES',
      severity: 'warning',
      message: `${source.gameSites.length} Phaser.Game creations were found and will all be patched.`,
      runtimeImpact: true
    })
  }
  for (const cssImport of source.cssImports) {
    diagnostics.push({
      code: 'CSS_IMPORT_REMOVED',
      severity: 'warning',
      message: `CSS side-effect import will be removed: ${cssImport}`,
      runtimeImpact: false,
      file: cssImport.split(':', 1)[0]
    })
  }
  for (const usage of source.networkApis) {
    diagnostics.push({
      code: 'DIRECT_NETWORK_API',
      severity: 'warning',
      message: `Direct business-network API usage requires manual review: ${usage}`,
      runtimeImpact: true,
      file: usage.split(':', 1)[0]
    })
  }
  for (const usage of source.browserGlobals) {
    diagnostics.push({
      code: 'BROWSER_GLOBAL_SHIMMED',
      severity: 'info',
      message: `Browser global usage will rely on the WeChat runtime shim: ${usage}`,
      runtimeImpact: false,
      file: usage.split(':', 1)[0]
    })
  }

  const inferred = source.gameSites.find((site) => site.width !== undefined || site.height !== undefined)
  return {
    projectRoot,
    packageJsonPath,
    packageName: packageJson.name ?? path.basename(projectRoot),
    indexHtmlPath,
    entryPath,
    viteConfigPath,
    phaserVersion,
    source,
    inferredWidth: inferred?.width,
    inferredHeight: inferred?.height,
    diagnostics
  }
}

export function analyzeSourceText(
  sourceText: string,
  fileName = 'src/main.ts',
  numericBindings: ReadonlyMap<string, number> = new Map()
): SourceAnalysis {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName)
  )
  const namespaceBindings = new Set<string>()
  const gameBindings = new Set<string>()
  const variableInitializers = new Map<string, ts.Expression>()
  const cssImports: string[] = []
  const assetReferences = new Set<string>()
  const networkApis = new Set<string>()
  const browserGlobals = new Set<string>()

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleName = statement.moduleSpecifier.text
      if (isCssModule(moduleName) && !statement.importClause) {
        cssImports.push(`${fileName}:${sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1}:${moduleName}`)
      }
      if (moduleName !== 'phaser' || statement.importClause?.isTypeOnly) continue
      const importClause = statement.importClause
      if (importClause?.name) namespaceBindings.add(importClause.name.text)
      const bindings = importClause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) namespaceBindings.add(bindings.name.text)
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue
          const importedName = element.propertyName?.text ?? element.name.text
          if (importedName === 'Game') gameBindings.add(element.name.text)
          if (importedName === 'default') namespaceBindings.add(element.name.text)
        }
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          variableInitializers.set(declaration.name.text, declaration.initializer)
        }
      }
    }
  }

  const gameSites: GameSite[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && /^\/?assets\//.test(node.text)) assetReferences.add(node.text)
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression)
        && node.expression.text === 'fetch'
        && !isPackagedFetch(node, variableInitializers)
      ) {
        networkApis.add(locationLabel(sourceFile, node, fileName, 'fetch'))
      }
      if (
        ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'wx'
        && node.expression.name.text === 'request'
      ) networkApis.add(locationLabel(sourceFile, node, fileName, 'wx.request'))
    }
    if (
      ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 'document' || node.expression.text === 'window')
    ) browserGlobals.add(locationLabel(sourceFile, node, fileName, node.expression.text))

    if (ts.isNewExpression(node)) {
      const constructorText = recognizedGameConstructor(node.expression, namespaceBindings, gameBindings)
      if (constructorText) {
        const config = node.arguments?.[0]
        const resolvedConfig = config ? resolveExpression(config, variableInitializers) : undefined
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        gameSites.push({
          file: fileName,
          line: position.line + 1,
          column: position.character + 1,
          constructorText,
          configText: config?.getText(sourceFile) ?? null,
          width: readConfigDimension(resolvedConfig, 'width', variableInitializers, numericBindings),
          height: readConfigDimension(resolvedConfig, 'height', variableInitializers, numericBindings)
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return {
    files: [fileName],
    gameSites,
    cssImports,
    assetReferences: [...assetReferences],
    networkApis: [...networkApis],
    browserGlobals: [...browserGlobals]
  }
}

function isPackagedFetch(call: ts.CallExpression, variables: Map<string, ts.Expression>): boolean {
  const prefix = staticStringPrefix(call.arguments[0], call, variables)
  return prefix !== undefined && /^(?:\.\/|\/?(?:assets|content)\/)/i.test(prefix.replace(/\\/g, '/'))
}

function staticStringPrefix(
  expression: ts.Expression | undefined,
  context: ts.Node,
  variables: Map<string, ts.Expression>,
  seen = new Set<ts.Node>()
): string | undefined {
  if (!expression || seen.has(expression)) return undefined
  seen.add(expression)
  const value = resolveExpression(expression, variables)
  if (!value) return undefined
  if (ts.isStringLiteralLike(value)) return value.text
  if (isViteBaseUrl(value)) return './'
  if (ts.isTemplateExpression(value)) {
    let prefix = value.head.text
    for (const span of value.templateSpans) {
      const part = staticStringPrefix(span.expression, context, variables, seen)
      if (part === undefined) return prefix || undefined
      prefix += part + span.literal.text
    }
    return prefix
  }
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringPrefix(value.left, context, variables, seen)
    if (left === undefined) return undefined
    const right = staticStringPrefix(value.right, context, variables, seen)
    return right === undefined ? left : left + right
  }
  if (
    ts.isPropertyAccessExpression(value)
    && value.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    const containingClass = findContainingClass(context)
    const member = containingClass?.members.find((candidate) => (
      ts.isPropertyDeclaration(candidate)
      && candidate.initializer
      && getPropertyName(candidate.name) === value.name.text
    ))
    if (member && ts.isPropertyDeclaration(member)) {
      return staticStringPrefix(member.initializer, context, variables, seen)
    }
  }
  return undefined
}

function isViteBaseUrl(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'BASE_URL') return false
  const env = expression.expression
  if (!ts.isPropertyAccessExpression(env) || env.name.text !== 'env') return false
  return ts.isMetaProperty(env.expression)
    && env.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    && env.expression.name.text === 'meta'
}

function findContainingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) return current
    current = current.parent
  }
  return undefined
}

async function analyzeSourceGraph(projectRoot: string, entryPath: string): Promise<SourceAnalysis> {
  const pending = [entryPath]
  const visited = new Set<string>()
  const gameSites: GameSite[] = []
  const cssImports: string[] = []
  const assetReferences = new Set<string>()
  const networkApis = new Set<string>()
  const browserGlobals = new Set<string>()

  while (pending.length > 0) {
    const filePath = path.normalize(pending.pop()!)
    if (visited.has(filePath)) continue
    visited.add(filePath)
    const sourceText = await readFile(filePath, 'utf8')
    const relative = normalizeRelative(projectRoot, filePath)
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind(filePath))
    const numericBindings = await collectImportedNumericBindings(filePath, sourceFile)
    const analysis = analyzeSourceText(sourceText, relative, numericBindings)
    gameSites.push(...analysis.gameSites)
    cssImports.push(...analysis.cssImports)
    analysis.assetReferences.forEach((asset) => assetReferences.add(asset))
    analysis.networkApis.forEach((usage) => networkApis.add(usage))
    analysis.browserGlobals.forEach((usage) => browserGlobals.add(usage))

    for (const specifier of collectRelativeImports(sourceFile)) {
      if (isCssModule(specifier)) continue
      const resolved = await resolveSourceImport(path.dirname(filePath), specifier)
      if (resolved && isInside(projectRoot, resolved)) pending.push(resolved)
    }
  }

  return {
    files: [...visited].map((file) => normalizeRelative(projectRoot, file)).sort(),
    gameSites,
    cssImports,
    assetReferences: [...assetReferences].sort(),
    networkApis: [...networkApis].sort(),
    browserGlobals: [...browserGlobals].sort()
  }
}

async function collectImportedNumericBindings(
  filePath: string,
  sourceFile: ts.SourceFile
): Promise<Map<string, number>> {
  const bindings = new Map<string, number>()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || statement.importClause?.isTypeOnly
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.moduleSpecifier.text.startsWith('.')
    ) continue
    const namedBindings = statement.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue
    const importedPath = await resolveSourceImport(path.dirname(filePath), statement.moduleSpecifier.text)
    if (!importedPath) continue
    const importedText = await readFile(importedPath, 'utf8')
    const importedSource = ts.createSourceFile(
      importedPath,
      importedText,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(importedPath)
    )
    const exportedNumbers = collectExportedNumbers(importedSource)
    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue
      const importedName = element.propertyName?.text ?? element.name.text
      const value = exportedNumbers.get(importedName)
      if (value !== undefined) bindings.set(element.name.text, value)
    }
  }
  return bindings
}

function collectExportedNumbers(sourceFile: ts.SourceFile): Map<string, number> {
  const result = new Map<string, number>()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement)
      || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      const value = literalNumber(declaration.initializer)
      if (value !== undefined) result.set(declaration.name.text, value)
    }
  }
  return result
}

function literalNumber(expression: ts.Expression | undefined): number | undefined {
  if (!expression) return undefined
  let value = expression
  while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) {
    value = value.expression
  }
  if (ts.isNumericLiteral(value)) return Number(value.text)
  if (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)) {
    const number = Number(value.operand.text)
    return value.operator === ts.SyntaxKind.MinusToken ? -number : number
  }
  return undefined
}

function collectRelativeImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.moduleSpecifier.text.startsWith('.')) imports.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0]!)
      && node.arguments[0]!.text.startsWith('.')
    ) {
      imports.push(node.arguments[0]!.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return imports
}

function recognizedGameConstructor(
  expression: ts.Expression,
  namespaceBindings: Set<string>,
  gameBindings: Set<string>
): string | undefined {
  if (ts.isIdentifier(expression) && gameBindings.has(expression.text)) return expression.text
  if (
    ts.isPropertyAccessExpression(expression)
    && expression.name.text === 'Game'
    && ts.isIdentifier(expression.expression)
    && namespaceBindings.has(expression.expression.text)
  ) return expression.getText()
  return undefined
}

function readConfigDimension(
  expression: ts.Expression | undefined,
  dimension: 'width' | 'height',
  variables: Map<string, ts.Expression>,
  numericBindings: ReadonlyMap<string, number>
): number | undefined {
  const object = expression ? resolveExpression(expression, variables) : undefined
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined
  const direct = readObjectProperty(object, dimension, variables)
  const directNumber = numericValue(direct, numericBindings)
  if (directNumber !== undefined) return directNumber
  const scale = resolveExpression(readObjectProperty(object, 'scale', variables), variables)
  if (!scale || !ts.isObjectLiteralExpression(scale)) return undefined
  return numericValue(readObjectProperty(scale, dimension, variables), numericBindings)
}

function readObjectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  variables: Map<string, ts.Expression>
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
    const propertyName = property.name && getPropertyName(property.name)
    if (propertyName !== name) continue
    if (ts.isShorthandPropertyAssignment(property)) return variables.get(property.name.text)
    return resolveExpression(property.initializer, variables)
  }
  return undefined
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

function resolveExpression(
  expression: ts.Expression | undefined,
  variables: Map<string, ts.Expression>,
  seen = new Set<string>()
): ts.Expression | undefined {
  if (!expression) return undefined
  let current = expression
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression
  }
  if (ts.isIdentifier(current) && !seen.has(current.text)) {
    const next = variables.get(current.text)
    if (next) {
      seen.add(current.text)
      return resolveExpression(next, variables, seen)
    }
  }
  return current
}

function numericValue(
  expression: ts.Expression | undefined,
  numericBindings: ReadonlyMap<string, number> = new Map()
): number | undefined {
  if (!expression) return undefined
  if (ts.isIdentifier(expression)) return numericBindings.get(expression.text)
  if (ts.isNumericLiteral(expression)) return Number(expression.text)
  if (ts.isPrefixUnaryExpression(expression) && ts.isNumericLiteral(expression.operand)) {
    const value = Number(expression.operand.text)
    return expression.operator === ts.SyntaxKind.MinusToken ? -value : value
  }
  return undefined
}

async function discoverHtmlEntry(projectRoot: string, html: string): Promise<string> {
  const scripts = [...html.matchAll(/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
  const reverseScripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*\btype\s*=\s*["']module["'][^>]*>/gi)]
  const source = scripts[0]?.[1] ?? reverseScripts[0]?.[1]
  if (!source) throw new Error('index.html does not contain a module script entry.')
  const clean = source.split(/[?#]/, 1)[0]!.replace(/^\//, '')
  const entryPath = path.resolve(projectRoot, clean)
  await access(entryPath).catch(() => {
    throw new Error(`Module entry does not exist: ${entryPath}`)
  })
  return entryPath
}

async function resolvePhaserVersion(projectRoot: string, packageJson: PackageJson): Promise<string> {
  const installed = await findInstalledPackageJson(projectRoot, 'phaser')
  if (installed) {
    const value = await readJson<{ version?: string }>(installed, 'installed Phaser package')
    if (value.version) return value.version
  }
  const declared = packageJson.dependencies?.phaser ?? packageJson.devDependencies?.phaser
  if (!declared) throw new Error('package.json does not declare Phaser.')
  const match = declared.match(/(\d+\.\d+\.\d+)/)
  if (!match) throw new Error(`Cannot determine the Phaser version from dependency: ${declared}`)
  return match[1]!
}

export async function findInstalledPackageJson(projectRoot: string, packageName: string): Promise<string | undefined> {
  let current = path.resolve(projectRoot)
  const segments = packageName.split('/')
  while (true) {
    const candidate = path.join(current, 'node_modules', ...segments, 'package.json')
    if (await pathExists(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

async function resolveSourceImport(directory: string, specifier: string): Promise<string | undefined> {
  const raw = path.resolve(directory, specifier)
  const candidates = path.extname(raw)
    ? [raw, ...SOURCE_EXTENSIONS.map((extension) => raw.slice(0, -path.extname(raw).length) + extension)]
    : [...SOURCE_EXTENSIONS.map((extension) => raw + extension), ...SOURCE_EXTENSIONS.map((extension) => path.join(raw, `index${extension}`))]
  for (const candidate of candidates) if (await pathExists(candidate)) return candidate
  return undefined
}

function scriptKind(fileName: string): ts.ScriptKind {
  const extension = path.extname(fileName).toLowerCase()
  if (extension === '.tsx') return ts.ScriptKind.TSX
  if (extension === '.jsx') return ts.ScriptKind.JSX
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function locationLabel(sourceFile: ts.SourceFile, node: ts.Node, fileName: string, name: string): string {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return `${fileName}:${position.line + 1}:${name}`
}

function isCssModule(value: string): boolean {
  return /\.(?:css|less|sass|scss|styl|stylus)(?:\?|$)/i.test(value)
}

function normalizeRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/')
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function existingPaths(root: string, names: string[]): Promise<string[]> {
  const result: string[] = []
  for (const name of names) {
    const candidate = path.join(root, name)
    if (await pathExists(candidate)) result.push(candidate)
  }
  return result
}

async function pathExists(value: string): Promise<boolean> {
  return access(value).then(() => true, () => false)
}

async function readJson<T>(filePath: string, label: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
