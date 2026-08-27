import path from 'node:path'
import ts from 'typescript'
import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

export interface TransformStats {
  transformedGames: number
  removedCssImports: string[]
  rewrittenAssets: string[]
}

interface Replacement {
  start: number
  end: number
  text: string
}

export function transformPhaserSource(
  sourceText: string,
  id: string,
  stats: TransformStats,
  fontFamilies: readonly string[] = []
): { code: string; changed: boolean } {
  const cleanId = id.split('?', 1)[0]!
  if (!/\.(?:[cm]?[jt]sx?)$/i.test(cleanId)) return { code: sourceText, changed: false }
  const sourceFile = ts.createSourceFile(cleanId, sourceText, ts.ScriptTarget.Latest, true, scriptKind(cleanId))
  const namespaceBindings = new Set<string>()
  const gameBindings = new Set<string>()
  const replacements: Replacement[] = []

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const moduleName = statement.moduleSpecifier.text
    if (isCssModule(moduleName) && !statement.importClause) {
      const end = consumeLineBreak(sourceText, statement.getEnd())
      replacements.push({ start: statement.getStart(sourceFile), end, text: '' })
      stats.removedCssImports.push(`${normalizePath(cleanId)}:${moduleName}`)
      continue
    }
    if (moduleName !== 'phaser' || statement.importClause?.isTypeOnly) continue
    const clause = statement.importClause
    if (clause?.name) namespaceBindings.add(clause.name.text)
    const bindings = clause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) namespaceBindings.add(bindings.name.text)
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue
        const imported = element.propertyName?.text ?? element.name.text
        if (imported === 'Game') gameBindings.add(element.name.text)
        if (imported === 'default') namespaceBindings.add(element.name.text)
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const assetArguments = loaderAssetArguments(node)
      if (assetArguments.length > 0) {
        const wrapped = new Set<ts.Expression>(assetArguments)
        for (const argument of assetArguments) {
          replacements.push({
            start: argument.getStart(sourceFile),
            end: argument.getEnd(),
            text: `globalThis.__PHASER_WECHAT_RESOLVE_ASSET_URL__(${argument.getText(sourceFile)})`
          })
        }
        visit(node.expression)
        for (const argument of node.arguments) if (!wrapped.has(argument)) visit(argument)
        return
      }
    }

    if (ts.isStringLiteralLike(node) && node.text.startsWith('/assets/')) {
      const rewritten = node.text.slice(1)
      replacements.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: JSON.stringify(rewritten) })
      stats.rewrittenAssets.push(`${node.text} -> ${rewritten}`)
      return
    }

    if (
      ts.isStringLiteralLike(node)
      && fontFamilies.some((family) => node.text.includes(family))
    ) {
      replacements.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        text: `globalThis.__PHASER_WECHAT_RESOLVE_FONT_FAMILY__(${JSON.stringify(node.text)})`
      })
      return
    }

    if (ts.isNewExpression(node)) {
      const constructor = gameConstructor(node.expression, namespaceBindings, gameBindings)
      if (constructor) {
        const args = node.arguments?.map((argument) => argument.getText(sourceFile)).join(', ') ?? ''
        replacements.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          text: `globalThis.__PHASER_WECHAT_CREATE_GAME__(${constructor}, ${args})`
        })
        stats.transformedGames++
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  if (replacements.length === 0) return { code: sourceText, changed: false }
  replacements.sort((left, right) => right.start - left.start)
  let code = sourceText
  let lastStart = sourceText.length + 1
  for (const replacement of replacements) {
    if (replacement.end > lastStart) continue
    code = code.slice(0, replacement.start) + replacement.text + code.slice(replacement.end)
    lastStart = replacement.start
  }
  return { code, changed: true }
}

export function createWechatTransformPlugin(options: {
  projectRoot: string
  entryPath: string
  fontFamilies?: readonly string[]
  stats: TransformStats
}): Plugin {
  const bootstrapId = '\0phaser-wechat-bootstrap'
  const projectRoot = path.resolve(options.projectRoot)

  return {
    name: 'phaser-editor-wechat-minigame',
    enforce: 'pre',
    resolveId(source) {
      if (source === 'virtual:phaser-wechat-bootstrap') return bootstrapId
      if (source === 'virtual:phaser-wechat-project-entry') return options.entryPath
      return null
    },
    load(id) {
      if (id === bootstrapId) {
        return 'import "virtual:phaser-wechat-project-entry";'
      }
      return null
    },
    transform(code, id) {
      const cleanId = path.normalize(id.split('?', 1)[0]!)
      if (!isInside(projectRoot, cleanId)) return null
      const transformed = transformPhaserSource(code, id, options.stats, options.fontFamilies)
      return transformed.changed ? { code: transformed.code, map: null } : null
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  if (!path.isAbsolute(candidate)) return false
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function gameConstructor(
  expression: ts.Expression,
  namespaces: Set<string>,
  games: Set<string>
): string | undefined {
  if (ts.isIdentifier(expression) && games.has(expression.text)) return expression.getText()
  if (
    ts.isPropertyAccessExpression(expression)
    && expression.name.text === 'Game'
    && ts.isIdentifier(expression.expression)
    && namespaces.has(expression.expression.text)
  ) return expression.getText()
  return undefined
}

function loaderAssetArguments(call: ts.CallExpression): ts.Expression[] {
  if (!ts.isPropertyAccessExpression(call.expression)) return []
  const loaderAccess = call.expression.expression
  if (!ts.isPropertyAccessExpression(loaderAccess) || loaderAccess.name.text !== 'load') return []
  const indices = loaderAssetArgumentIndices[call.expression.name.text]
  if (!indices) return []
  return indices.flatMap((index) => call.arguments[index] ? [call.arguments[index]!] : [])
}

const loaderAssetArgumentIndices: Readonly<Record<string, readonly number[]>> = {
  image: [1],
  spritesheet: [1],
  svg: [1],
  bitmapFont: [1, 2],
  atlas: [1, 2],
  atlasXML: [1, 2],
  atlasJSONArray: [1, 2],
  atlasJSONHash: [1, 2],
  unityAtlas: [1, 2]
}

function consumeLineBreak(source: string, offset: number): number {
  if (source.slice(offset, offset + 2) === '\r\n') return offset + 2
  if (source[offset] === '\n' || source[offset] === '\r') return offset + 1
  return offset
}

function isCssModule(value: string): boolean {
  return /\.(?:css|less|sass|scss|styl|stylus)(?:\?|$)/i.test(value)
}

function scriptKind(fileName: string): ts.ScriptKind {
  const extension = path.extname(fileName).toLowerCase()
  if (extension === '.tsx') return ts.ScriptKind.TSX
  if (extension === '.jsx') return ts.ScriptKind.JSX
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}
