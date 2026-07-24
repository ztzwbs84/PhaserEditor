/// <reference types="vite/client" />

declare module '*.css'

declare module 'culori' {
  export function parse(value: string): unknown | undefined
  export function formatHex(value: unknown): string
  export function formatRgb(value: unknown): string
  export function formatHsl(value: unknown): string
}
