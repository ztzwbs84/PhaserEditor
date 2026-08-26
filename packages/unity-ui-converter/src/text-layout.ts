import type { Color, UITextComponent } from './schema.js'

export interface UnityTextBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface UnityTextGlyph {
  character: string
  x: number
  baseline: number
  width: number
  ascent: number
  descent: number
  font: string
  color: string
}

export interface UnityTextLine {
  x: number
  y: number
  width: number
  height: number
  baseline: number
  glyphStart: number
  glyphEnd: number
}

export interface UnityTextLayout {
  fontSize: number
  boxWidth: number
  boxHeight: number
  contentWidth: number
  contentHeight: number
  bounds: UnityTextBounds
  clipped: boolean
  glyphs: UnityTextGlyph[]
  lines: UnityTextLine[]
}

export interface UnityTextLayoutOptions {
  fontFamily: string
  width: number
  height: number
}

interface TextStyle {
  size: number
  bold: boolean
  italic: boolean
  color: string
}

interface StyledToken {
  text: string
  style: TextStyle
  newline: boolean
  whitespace: boolean
}

interface DraftChunk {
  text: string
  style: TextStyle
  width: number
  characterCount: number
}

interface DraftLine {
  chunks: DraftChunk[]
  width: number
  ascent: number
  descent: number
  height: number
  characterCount: number
}

export function layoutUnityText(
  context: CanvasRenderingContext2D,
  component: UITextComponent,
  options: UnityTextLayoutOptions
): UnityTextLayout {
  const width = Math.max(0, options.width)
  const height = Math.max(0, options.height)
  let fontSize = Math.max(1, component.fontSize)
  let layout = layoutAtSize(context, component, options.fontFamily, width, height, fontSize)
  if (component.bestFit) {
    let low = Math.max(1, Math.floor(component.minSize))
    let high = Math.max(low, Math.floor(component.maxSize))
    let best = low
    while (low <= high) {
      const candidateSize = Math.floor((low + high) / 2)
      const candidate = layoutAtSize(context, component, options.fontFamily, width, height, candidateSize)
      if (candidate.contentWidth <= width + 0.01 && candidate.contentHeight <= height + 0.01) {
        best = candidateSize
        low = candidateSize + 1
      } else high = candidateSize - 1
    }
    fontSize = best
    layout = layoutAtSize(context, component, options.fontFamily, width, height, fontSize)
  }
  return layout
}

export function measureUnityText(
  context: CanvasRenderingContext2D,
  component: UITextComponent,
  maxWidth: number | null,
  fontFamily: string
): { width: number; height: number } {
  const width = maxWidth == null ? Number.MAX_SAFE_INTEGER : Math.max(0, maxWidth)
  const layout = layoutUnityText(context, component, {
    fontFamily,
    width,
    height: Number.MAX_SAFE_INTEGER
  })
  return { width: layout.contentWidth, height: layout.contentHeight }
}

export function drawUnityText(
  context: CanvasRenderingContext2D,
  layout: UnityTextLayout,
  component: UITextComponent,
  offsetX = 0,
  offsetY = 0
): void {
  context.save()
  context.translate(offsetX, offsetY)
  if (layout.clipped) {
    context.beginPath()
    context.rect(0, 0, layout.boxWidth, layout.boxHeight)
    context.clip()
  }
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  const shadow = component.effects.find((effect) => effect.type === 'shadow')
  const outline = component.effects.find((effect) => effect.type === 'outline')
  for (const glyph of layout.glyphs) {
    context.font = glyph.font
    context.fillStyle = glyph.color
    if (shadow) {
      context.shadowColor = colorToCss(shadow.color)
      context.shadowOffsetX = shadow.distance.x
      context.shadowOffsetY = -shadow.distance.y
      context.shadowBlur = 0
    } else {
      context.shadowColor = 'transparent'
      context.shadowOffsetX = 0
      context.shadowOffsetY = 0
    }
    if (outline) {
      context.lineJoin = 'round'
      context.lineWidth = Math.max(1, Math.max(Math.abs(outline.distance.x), Math.abs(outline.distance.y)) * 2)
      context.strokeStyle = colorToCss(outline.color)
      context.strokeText(glyph.character, glyph.x, glyph.baseline)
    }
    context.fillText(glyph.character, glyph.x, glyph.baseline)
  }
  context.restore()
}

function layoutAtSize(
  context: CanvasRenderingContext2D,
  component: UITextComponent,
  fontFamily: string,
  boxWidth: number,
  boxHeight: number,
  baseFontSize: number
): UnityTextLayout {
  const tokens = parseRichText(component, baseFontSize)
  const wrap = horizontalOverflow(component) === 'wrap' && boxWidth < Number.MAX_SAFE_INTEGER
  const draftLines = buildLines(context, tokens, component, fontFamily, wrap ? boxWidth : null, baseFontSize)
  const contentWidth = Math.max(0, ...draftLines.map((line) => line.width))
  const contentHeight = draftLines.reduce((sum, line) => sum + line.height, 0)
  const horizontal = horizontalAlignment(component)
  const vertical = verticalAlignment(component)
  const verticalOffset = (boxHeight - contentHeight) * verticalFactor(vertical)
  const glyphs: UnityTextGlyph[] = []
  const lines: UnityTextLine[] = []
  let lineY = verticalOffset

  draftLines.forEach((line, lineIndex) => {
    const justify = horizontal === 'flush' || (horizontal === 'justified' && lineIndex < draftLines.length - 1)
    const whitespaceCount = justify ? line.chunks.reduce((count, chunk) => count + Array.from(chunk.text).filter((character) => /\s/u.test(character)).length, 0) : 0
    const justifySpacing = whitespaceCount > 0 ? Math.max(0, boxWidth - line.width) / whitespaceCount : 0
    const alignedX = justify ? 0 : (boxWidth - line.width) * horizontalFactor(horizontal)
    const baseline = lineY + Math.max(0, (line.height - line.ascent - line.descent) / 2) + line.ascent
    const glyphStart = glyphs.length
    let x = alignedX
    let seenCharacter = false
    for (const chunk of line.chunks) {
      const font = fontFor(chunk.style, fontFamily)
      context.font = font
      for (const character of Array.from(chunk.text)) {
        if (seenCharacter) x += component.characterSpacing
        const metrics = measureCharacter(context, character, chunk.style.size)
        glyphs.push({
          character: character === '\t' ? '    ' : character,
          x,
          baseline,
          width: metrics.width,
          ascent: metrics.ascent,
          descent: metrics.descent,
          font,
          color: chunk.style.color
        })
        x += metrics.width
        if (/\s/u.test(character)) x += justifySpacing
        seenCharacter = true
      }
    }
    lines.push({ x: alignedX, y: lineY, width: x - alignedX, height: line.height, baseline, glyphStart, glyphEnd: glyphs.length })
    lineY += line.height
  })

  const clipped = verticalOverflow(component) === 'truncate'
  const effectExpansion = textEffectExpansion(component)
  let minX = 0
  let minY = 0
  let maxX = boxWidth
  let maxY = boxHeight
  if (!clipped && glyphs.length > 0) {
    for (const glyph of glyphs) {
      minX = Math.min(minX, glyph.x - effectExpansion.left)
      minY = Math.min(minY, glyph.baseline - glyph.ascent - effectExpansion.top)
      maxX = Math.max(maxX, glyph.x + glyph.width + effectExpansion.right)
      maxY = Math.max(maxY, glyph.baseline + glyph.descent + effectExpansion.bottom)
    }
  }
  return {
    fontSize: baseFontSize,
    boxWidth,
    boxHeight,
    contentWidth,
    contentHeight,
    bounds: clipped
      ? { x: 0, y: 0, width: boxWidth, height: boxHeight }
      : { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) },
    clipped,
    glyphs,
    lines
  }
}

function buildLines(
  context: CanvasRenderingContext2D,
  tokens: StyledToken[],
  component: UITextComponent,
  fontFamily: string,
  wrapWidth: number | null,
  baseFontSize: number
): DraftLine[] {
  if (tokens.length === 0) return []
  const lines: DraftLine[] = []
  let line = emptyDraftLine()
  const finishLine = (): void => {
    finalizeLine(context, line, component, fontFamily, baseFontSize)
    lines.push(line)
    line = emptyDraftLine()
  }

  for (const token of tokens) {
    if (token.newline) {
      finishLine()
      continue
    }
    const chunk = measureChunk(context, token.text, token.style, component.characterSpacing, fontFamily)
    const precedingSpacing = line.characterCount > 0 && chunk.characterCount > 0 ? component.characterSpacing : 0
    if (wrapWidth != null && line.characterCount > 0 && line.width + precedingSpacing + chunk.width > wrapWidth + 0.01) {
      finishLine()
      if (token.whitespace) continue
    }
    if (wrapWidth != null && chunk.width > wrapWidth + 0.01 && !token.whitespace) {
      for (const character of Array.from(token.text)) {
        const characterChunk = measureChunk(context, character, token.style, component.characterSpacing, fontFamily)
        const spacing = line.characterCount > 0 ? component.characterSpacing : 0
        if (line.characterCount > 0 && line.width + spacing + characterChunk.width > wrapWidth + 0.01) finishLine()
        appendChunk(line, characterChunk, component.characterSpacing)
      }
    } else appendChunk(line, chunk, component.characterSpacing)
  }
  finishLine()
  return lines
}

function emptyDraftLine(): DraftLine {
  return { chunks: [], width: 0, ascent: 0, descent: 0, height: 0, characterCount: 0 }
}

function appendChunk(line: DraftLine, chunk: DraftChunk, characterSpacing: number): void {
  if (chunk.characterCount === 0) return
  if (line.characterCount > 0) line.width += characterSpacing
  line.chunks.push(chunk)
  line.width += chunk.width
  line.characterCount += chunk.characterCount
}

function finalizeLine(
  context: CanvasRenderingContext2D,
  line: DraftLine,
  component: UITextComponent,
  fontFamily: string,
  baseFontSize: number
): void {
  const styles = line.chunks.length > 0 ? line.chunks.map((chunk) => chunk.style) : [{ size: baseFontSize, bold: false, italic: false, color: colorToCss(component.color) }]
  for (const style of styles) {
    context.font = fontFor(style, fontFamily)
    const metrics = measureCharacter(context, 'M', style.size)
    line.ascent = Math.max(line.ascent, metrics.ascent)
    line.descent = Math.max(line.descent, metrics.descent)
  }
  const largestSize = Math.max(baseFontSize, ...styles.map((style) => style.size))
  const requestedHeight = component.type === 'text'
    ? largestSize * Math.max(0.1, component.lineSpacing)
    : largestSize + component.lineSpacing
  line.height = Math.max(1, line.ascent + line.descent, requestedHeight)
}

function measureChunk(
  context: CanvasRenderingContext2D,
  text: string,
  style: TextStyle,
  characterSpacing: number,
  fontFamily: string
): DraftChunk {
  context.font = fontFor(style, fontFamily)
  const characters = Array.from(text)
  let width = 0
  for (const [index, character] of characters.entries()) {
    if (index > 0) width += characterSpacing
    width += measureCharacter(context, character, style.size).width
  }
  return { text, style, width, characterCount: characters.length }
}

function measureCharacter(context: CanvasRenderingContext2D, character: string, fontSize: number): { width: number; ascent: number; descent: number } {
  const measured = context.measureText(character === '\t' ? '    ' : character)
  return {
    width: measured.width,
    ascent: measured.actualBoundingBoxAscent || fontSize * 0.8,
    descent: measured.actualBoundingBoxDescent || fontSize * 0.2
  }
}

function parseRichText(component: UITextComponent, baseFontSize: number): StyledToken[] {
  const baseStyle: TextStyle = {
    size: baseFontSize,
    bold: component.fontStyle === 1 || component.fontStyle === 3 || Boolean(component.fontStyle & 1),
    italic: component.fontStyle === 2 || component.fontStyle === 3 || Boolean(component.fontStyle & 2),
    color: colorToCss(component.color)
  }
  const runs = component.richText ? parseRichRuns(component.text, baseStyle, component.fontSize) : [{ text: component.text, style: baseStyle }]
  const tokens: StyledToken[] = []
  for (const run of runs) {
    for (const match of run.text.matchAll(/\r\n|\r|\n|[ \t]+|[A-Za-z0-9_]+|./gu)) {
      const text = match[0]
      tokens.push({ text, style: run.style, newline: /^(?:\r\n|\r|\n)$/u.test(text), whitespace: /^[ \t]+$/u.test(text) })
    }
  }
  return tokens
}

function parseRichRuns(text: string, baseStyle: TextStyle, serializedBaseSize: number): Array<{ text: string; style: TextStyle }> {
  const runs: Array<{ text: string; style: TextStyle }> = []
  const stack: Array<{ tag: 'b' | 'i' | 'size' | 'color'; style: TextStyle }> = []
  let style = { ...baseStyle }
  let cursor = 0
  const pattern = /<\/?(?:b|i|size|color)(?:=(?:"[^"]*"|'[^']*'|[^>]+))?>/giu
  for (const match of text.matchAll(pattern)) {
    if (match.index! > cursor) runs.push({ text: text.slice(cursor, match.index), style: { ...style } })
    const raw = match[0]
    const closing = /^<\//u.test(raw)
    const tag = raw.match(/^<\/?(b|i|size|color)/iu)?.[1]?.toLowerCase() as 'b' | 'i' | 'size' | 'color' | undefined
    if (tag) {
      if (closing) {
        const stackIndex = stack.map((entry) => entry.tag).lastIndexOf(tag)
        if (stackIndex >= 0) {
          style = { ...stack[stackIndex]!.style }
          stack.splice(stackIndex)
        }
      } else {
        stack.push({ tag, style: { ...style } })
        const value = raw.match(/=\s*["']?([^>"']+)/u)?.[1]?.trim()
        if (tag === 'b') style.bold = true
        if (tag === 'i') style.italic = true
        if (tag === 'size' && value) {
          const size = Number(value)
          if (Number.isFinite(size) && size > 0) style.size = size * baseStyle.size / Math.max(1, serializedBaseSize)
        }
        if (tag === 'color' && value) style.color = normalizeColor(value, baseStyle.color)
      }
    }
    cursor = match.index! + raw.length
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), style: { ...style } })
  return runs
}

function horizontalAlignment(component: UITextComponent): NonNullable<UITextComponent['horizontalAlignment']> {
  if (component.horizontalAlignment) return component.horizontalAlignment
  if (component.type === 'text') return (['left', 'center', 'right'] as const)[Math.max(0, component.alignment) % 3] ?? 'left'
  if (component.alignment & 32) return 'geometry'
  if (component.alignment & 16) return 'flush'
  if (component.alignment & 8) return 'justified'
  if (component.alignment & 4) return 'right'
  if (component.alignment & 2) return 'center'
  return 'left'
}

function verticalAlignment(component: UITextComponent): NonNullable<UITextComponent['verticalAlignment']> {
  if (component.verticalAlignment) return component.verticalAlignment
  if (component.type === 'text') return (['top', 'middle', 'bottom'] as const)[Math.floor(Math.max(0, component.alignment) / 3)] ?? 'top'
  if (component.alignment & 8192) return 'capline'
  if (component.alignment & 4096) return 'midline'
  if (component.alignment & 2048) return 'baseline'
  if (component.alignment & 1024) return 'bottom'
  if (component.alignment & 512) return 'middle'
  return 'top'
}

function horizontalFactor(alignment: NonNullable<UITextComponent['horizontalAlignment']>): number {
  return alignment === 'center' || alignment === 'geometry' ? 0.5 : alignment === 'right' ? 1 : 0
}

function verticalFactor(alignment: NonNullable<UITextComponent['verticalAlignment']>): number {
  return alignment === 'middle' || alignment === 'midline' ? 0.5 : alignment === 'bottom' || alignment === 'baseline' ? 1 : 0
}

function horizontalOverflow(component: UITextComponent): 'wrap' | 'overflow' {
  return component.horizontalOverflowMode ?? (component.wordWrap ? 'wrap' : 'overflow')
}

function verticalOverflow(component: UITextComponent): 'truncate' | 'overflow' {
  return component.verticalOverflowMode ?? (component.verticalOverflow === 1 ? 'overflow' : 'truncate')
}

function fontFor(style: TextStyle, fontFamily: string): string {
  const family = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui)$/u.test(fontFamily) ? fontFamily : JSON.stringify(fontFamily)
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${Math.max(1, style.size)}px ${family}`
}

function textEffectExpansion(component: UITextComponent): { left: number; right: number; top: number; bottom: number } {
  let left = 0
  let right = 0
  let top = 0
  let bottom = 0
  for (const effect of component.effects) {
    const size = Math.max(Math.abs(effect.distance.x), Math.abs(effect.distance.y))
    if (effect.type === 'outline') left = right = top = bottom = Math.max(left, size)
    else {
      left = Math.max(left, Math.max(0, -effect.distance.x))
      right = Math.max(right, Math.max(0, effect.distance.x))
      top = Math.max(top, Math.max(0, effect.distance.y))
      bottom = Math.max(bottom, Math.max(0, -effect.distance.y))
    }
  }
  return { left, right, top, bottom }
}

function normalizeColor(value: string, fallback: string): string {
  const color = value.trim()
  if (/^#[0-9a-f]{3,8}$/iu.test(color)) {
    if (color.length === 9) {
      const alpha = Number.parseInt(color.slice(7, 9), 16) / 255
      return `rgba(${Number.parseInt(color.slice(1, 3), 16)},${Number.parseInt(color.slice(3, 5), 16)},${Number.parseInt(color.slice(5, 7), 16)},${alpha})`
    }
    return color
  }
  return fallback
}

function colorToCss(color: Color): string {
  return `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${color.a})`
}
