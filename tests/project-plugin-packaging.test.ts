import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configureProjectPluginEsbuildBinary } from '../src/main/project-plugin-compiler'

const originalBinaryPath = process.env.ESBUILD_BINARY_PATH

afterEach(() => {
  if (originalBinaryPath === undefined) delete process.env.ESBUILD_BINARY_PATH
  else process.env.ESBUILD_BINARY_PATH = originalBinaryPath
})

describe('project plugin compiler packaging', () => {
  it('ships the Windows esbuild binary outside ASAR and selects it in packaged mode', async () => {
    const packageJson = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8')) as {
      build: {
        asarUnpack?: string[]
        extraResources?: Array<{ from: string; to: string }>
      }
    }
    expect(packageJson.build.asarUnpack).toEqual(expect.arrayContaining([
      'node_modules/esbuild/**',
      'node_modules/@esbuild/**'
    ]))
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'node_modules/@esbuild/win32-x64/esbuild.exe',
      to: 'esbuild/esbuild.exe'
    })

    const binaryPath = configureProjectPluginEsbuildBinary(true, 'C:\\Program Files\\Phaser Editor\\resources', 'win32')
    expect(binaryPath).toBe(path.join('C:\\Program Files\\Phaser Editor\\resources', 'esbuild', 'esbuild.exe'))
    expect(process.env.ESBUILD_BINARY_PATH).toBe(binaryPath)
  })
})
