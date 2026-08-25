import type { CliOptions, Orientation } from './types.js'

const VALUE_FLAGS = new Set(['project', 'output', 'width', 'height', 'orientation', 'appid'])
const BOOLEAN_FLAGS = new Set(['no-install', 'force', 'dry-run', 'json', 'help'])

export function parseCliArgs(values: string[]): CliOptions {
  const raw = new Map<string, string | true>()

  for (let index = 0; index < values.length; index++) {
    const value = values[index]!
    if (value === '-h') {
      raw.set('help', true)
      continue
    }
    if (!value.startsWith('--')) throw new Error(`Unexpected argument: ${value}`)

    const equals = value.indexOf('=')
    const name = value.slice(2, equals === -1 ? undefined : equals)
    if (!VALUE_FLAGS.has(name) && !BOOLEAN_FLAGS.has(name)) throw new Error(`Unknown option: --${name}`)

    if (BOOLEAN_FLAGS.has(name)) {
      if (equals !== -1) throw new Error(`Option --${name} does not accept a value.`)
      raw.set(name, true)
      continue
    }

    const argument = equals === -1 ? values[++index] : value.slice(equals + 1)
    if (!argument || argument.startsWith('--')) throw new Error(`Option --${name} requires a value.`)
    raw.set(name, argument)
  }

  const orientation = raw.get('orientation') as string | undefined
  if (orientation && orientation !== 'portrait' && orientation !== 'landscape') {
    throw new Error('--orientation must be portrait or landscape.')
  }

  return {
    project: stringValue(raw, 'project'),
    output: stringValue(raw, 'output'),
    width: numberValue(raw, 'width'),
    height: numberValue(raw, 'height'),
    orientation: orientation as Orientation | undefined,
    appid: stringValue(raw, 'appid'),
    install: raw.get('no-install') !== true,
    force: raw.get('force') === true,
    dryRun: raw.get('dry-run') === true,
    json: raw.get('json') === true,
    help: raw.get('help') === true
  }
}

function stringValue(raw: Map<string, string | true>, name: string): string | undefined {
  const value = raw.get(name)
  return typeof value === 'string' ? value : undefined
}

function numberValue(raw: Map<string, string | true>, name: string): number | undefined {
  const value = stringValue(raw, name)
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0 || !Number.isInteger(number)) {
    throw new Error(`--${name} must be a positive integer.`)
  }
  return number
}
