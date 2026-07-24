import { formatHex, formatHsl, formatRgb, parse } from 'culori'

export interface ColorFormats {
  hex: string
  rgb: string
  hsl: string
}

export function convertColor(value: string): ColorFormats | null {
  const color = parse(value)
  if (!color) return null
  return {
    hex: formatHex(color).toLocaleUpperCase(),
    rgb: formatRgb(color),
    hsl: formatHsl(color)
  }
}

export function rgbaToHex(red: number, green: number, blue: number, alpha = 255): string {
  const values = [red, green, blue].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
  const alphaHex = Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, '0')
  return `#${values.join('')}${alpha === 255 ? '' : alphaHex}`.toLocaleUpperCase()
}
