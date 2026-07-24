import { afterEach, describe, expect, it, vi } from 'vitest'
import { settleShutdownTasks } from '../src/main/shutdown'

describe('application shutdown cleanup', () => {
  afterEach(() => vi.useRealTimers())

  it('runs every cleanup task even when another task throws or rejects', async () => {
    const completed = vi.fn()

    await expect(settleShutdownTasks([
      () => { throw new Error('synchronous failure') },
      async () => { throw new Error('asynchronous failure') },
      completed
    ])).resolves.toBeUndefined()

    expect(completed).toHaveBeenCalledOnce()
  })

  it('stops waiting at the shutdown deadline', async () => {
    vi.useFakeTimers()
    const cleanup = settleShutdownTasks([() => new Promise(() => undefined)], 25)

    await vi.advanceTimersByTimeAsync(25)

    await expect(cleanup).resolves.toBeUndefined()
  })
})
