export type ShutdownTask = () => void | Promise<unknown>

export async function settleShutdownTasks(tasks: ShutdownTask[], timeoutMs = 12_000): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs)
  })
  const cleanup = Promise.allSettled(tasks.map((task) => Promise.resolve().then(task))).then(() => undefined)

  await Promise.race([cleanup, deadline])
  if (timeout) clearTimeout(timeout)
}
