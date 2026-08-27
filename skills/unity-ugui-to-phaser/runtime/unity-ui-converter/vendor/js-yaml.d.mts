export const JSON_SCHEMA: unknown

export interface LoadOptions {
  schema?: unknown
}

export function load(source: string, options?: LoadOptions): unknown
