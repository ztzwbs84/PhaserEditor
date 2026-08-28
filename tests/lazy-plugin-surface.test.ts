import { describe, expect, it, vi } from 'vitest'
import {
  runPluginSurfaceOperation,
  type PluginSurfaceOperationPhase
} from '../src/renderer/src/components/common/LazyPluginSurface'

describe('plugin surface lifecycle boundary', () => {
  it.each([
    ['mount', 'sync'],
    ['mount', 'async'],
    ['update', 'sync'],
    ['update', 'async'],
    ['dispose', 'sync'],
    ['dispose', 'async']
  ] as const)('captures %s %s failures without rejecting', async (phase, mode) => {
    const onSuccess = vi.fn()
    const onFailure = vi.fn()
    const message = `${phase} ${mode} failure`
    const operation = mode === 'sync'
      ? () => { throw new Error(message) }
      : () => Promise.reject(new Error(message))

    await expect(runPluginSurfaceOperation(
      phase satisfies PluginSurfaceOperationPhase,
      operation,
      onSuccess,
      onFailure
    )).resolves.toBeUndefined()

    expect(onSuccess).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message }))
  })

  it('normalizes non-Error failures and delivers successful mount handles', async () => {
    const onFailure = vi.fn()
    const onSuccess = vi.fn()
    const handle = { dispose: vi.fn() }

    await runPluginSurfaceOperation('mount', () => handle, onSuccess, onFailure)
    await runPluginSurfaceOperation('update', () => Promise.reject('update unavailable'), undefined, onFailure)

    expect(onSuccess).toHaveBeenCalledWith(handle)
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'update unavailable' }))
  })

  it('contains cleanup diagnostic callback failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(runPluginSurfaceOperation(
      'dispose',
      () => Promise.reject(new Error('dispose failed')),
      undefined,
      async () => { throw new Error('diagnostic reporter failed') }
    )).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledWith(
      'Plugin surface dispose failure could not be reported.',
      expect.objectContaining({ message: 'diagnostic reporter failed' })
    )
    consoleError.mockRestore()
  })
})
