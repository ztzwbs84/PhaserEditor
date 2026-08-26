import { JSON_SCHEMA, load } from 'js-yaml'
import type { UIDiagnostic, Vec2, Vec3, Vec4, Color } from './schema.js'

export type UnknownRecord = Record<string, unknown>

export interface UnityYamlObject {
  classId: number
  fileId: string
  stripped: boolean
  typeName: string
  data: UnknownRecord
}

export interface UnityObjectReference {
  fileId: string
  guid?: string
  type?: number
}

const documentHeader = /^--- !u!(\d+) &(-?\d+)( stripped)?\r?$/gm

export function parseUnityYaml(source: string, sourcePath: string, diagnostics: UIDiagnostic[] = []): UnityYamlObject[] {
  const normalizedSource = normalizeKnownUnityYamlQuirks(source, sourcePath, diagnostics)
  const matches = [...normalizedSource.matchAll(documentHeader)]
  const objects: UnityYamlObject[] = []

  matches.forEach((match, index) => {
    const bodyStart = (match.index ?? 0) + match[0].length
    const bodyEnd = matches[index + 1]?.index ?? normalizedSource.length
    const body = normalizedSource.slice(bodyStart, bodyEnd).replace(/^\r?\n/, '')
    try {
      const parsed = load(quoteUnityFileIds(body), { schema: JSON_SCHEMA })
      const root = asRecord(parsed)
      const typeName = Object.keys(root)[0]
      if (!typeName) throw new Error('Document has no root type.')
      objects.push({
        classId: Number(match[1]),
        fileId: match[2] ?? '0',
        stripped: Boolean(match[3]),
        typeName,
        data: asRecord(root[typeName])
      })
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: 'UNITY_YAML_DOCUMENT_INVALID',
        message: error instanceof Error ? error.message : 'Unity YAML document could not be parsed.',
        sourcePath,
        details: { classId: Number(match[1]), fileId: match[2] ?? '0' }
      })
    }
  })

  if (matches.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'UNITY_YAML_HEADER_MISSING',
      message: 'No Unity YAML object headers were found. Binary serialization is not supported.',
      sourcePath
    })
  }
  return objects
}

export function quoteUnityFileIds(source: string): string {
  return source.replace(/(\b(?:fileID|internalID|first):\s*)(-?\d+)(?=\s*[,}\r\n])/g, '$1"$2"')
}

function normalizeKnownUnityYamlQuirks(source: string, sourcePath: string, diagnostics: UIDiagnostic[]): string {
  const normalized = source.replace(/^(\s*)m_Sprite:\s+m_Sprite:\s+/gm, '$1m_Sprite: ')
  if (normalized !== source) {
    diagnostics.push({
      severity: 'warning',
      code: 'UNITY_YAML_NORMALIZED',
      message: 'Normalized duplicated m_Sprite keys emitted by the Unity UI exporter.',
      sourcePath,
      details: { pattern: 'm_Sprite: m_Sprite:' }
    })
  }
  return normalized
}

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asNumber(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (value === 0 || value === '0') return false
  if (value === 1 || value === '1') return true
  return fallback
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value)
}

export function readReference(value: unknown): UnityObjectReference {
  const record = asRecord(value)
  const guid = typeof record.guid === 'string' && record.guid ? record.guid : undefined
  const type = record.type == null ? undefined : asNumber(record.type)
  return { fileId: asString(record.fileID, '0'), ...(guid ? { guid } : {}), ...(type == null ? {} : { type }) }
}

export function readVec2(value: unknown, fallback: Vec2 = { x: 0, y: 0 }): Vec2 {
  const record = asRecord(value)
  return { x: asNumber(record.x, fallback.x), y: asNumber(record.y, fallback.y) }
}

export function readVec3(value: unknown, fallback: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const record = asRecord(value)
  return { x: asNumber(record.x, fallback.x), y: asNumber(record.y, fallback.y), z: asNumber(record.z, fallback.z) }
}

export function readVec4(value: unknown, fallback: Vec4 = { x: 0, y: 0, z: 0, w: 0 }): Vec4 {
  const record = asRecord(value)
  return {
    x: asNumber(record.x, fallback.x),
    y: asNumber(record.y, fallback.y),
    z: asNumber(record.z, fallback.z),
    w: asNumber(record.w, fallback.w)
  }
}

export function readColor(value: unknown, fallback: Color = { r: 1, g: 1, b: 1, a: 1 }): Color {
  const record = asRecord(value)
  return {
    r: asNumber(record.r, fallback.r),
    g: asNumber(record.g, fallback.g),
    b: asNumber(record.b, fallback.b),
    a: asNumber(record.a, fallback.a)
  }
}
