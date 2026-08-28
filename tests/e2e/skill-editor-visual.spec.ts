import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const skillProject = process.env.PHASER_EDITOR_SKILL_PROJECT
const screenshotRoot = path.resolve('artifacts', 'screenshots', 'skill-editor')

test.skip(!skillProject, 'Set PHASER_EDITOR_SKILL_PROJECT to run the real project skill editor visual test.')

test.beforeAll(async () => {
  await fs.mkdir(screenshotRoot, { recursive: true })
})

test('renders the real project skill editor at wide and compact desktop sizes', async () => {
  test.setTimeout(180_000)
  const runId = `${Date.now()}-${process.pid}`
  const application = await launchEditor(`skill-editor-${runId}`)
  const rendererErrors: string[] = []
  let page: Page | null = null
  let bodyFailed = false
  try {
    page = await application.firstWindow()
    page.on('pageerror', (error) => rendererErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push(message.text())
    })

    await resizeWindow(application, 1600, 1000)
    await openProjectFromCenter(page, skillProject!)
    const trustDialog = page.getByRole('alertdialog', { name: 'Trust project plugins?' })
    await expect(trustDialog).toContainText('S3 Skill Editor')
    await expect(trustDialog).toContainText('filesystem:project')
    await trustDialog.getByRole('button', { name: 'Trust and load' }).click()
    await expect.poll(() => projectPluginState(page!), { timeout: 90_000 }).toEqual('ready')

    await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: '技能总览', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: '技能总览' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Tools', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: '打开技能总览' })).toBeVisible()
    await page.keyboard.press('Escape')

    await openProjectFile(page, '200201.json')
    const shadowHost = page.locator('.lazy-plugin-surface[data-plugin="s3-skill-editor"] .plugin-shadow-host')
    const editor = shadowHost.locator('.skill-editor')
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await expectHostDocumentClean(page, '200201.json')
    await expect(editor.locator('.hierarchy-pane')).toBeVisible()
    await expect(editor.locator('.timeline-pane')).toBeVisible()
    await expect(editor.locator('.inspector-pane')).toBeVisible()
    await expect(editor.getByRole('region', { name: '技能预览' })).toBeVisible()
    await expect(editor.locator('.timeline-clip').first()).toBeVisible()
    await editor.locator('.timeline-clip').first().click()
    await expect(editor.locator('.inspector-tabs')).toBeVisible()
    await expectHostDocumentClean(page, '200201.json')

    await expect.poll(async () => spineCanvasHasRenderedPixels(editor.locator('canvas[aria-label$="Spine preview"]').first()), { timeout: 20_000 }).toBe(true)
    await expect(editor.locator('.spine-error')).toHaveCount(0)
    expect(await editorLayout(editor)).toMatchObject({ overlaps: false, overflowX: false, overflowY: false })
    await page.screenshot({ path: path.join(screenshotRoot, 'skill-editor-1600x1000.png') })

    await resizeWindow(application, 1280, 800)
    await expect(editor).toBeVisible()
    expect(await editorLayout(editor)).toMatchObject({ overlaps: false, overflowX: false, overflowY: false })
    await expect(editor.getByLabel('轨道类型')).toBeVisible()
    await expect(editor.getByLabel('片段类型')).toBeVisible()
    await page.screenshot({ path: path.join(screenshotRoot, 'skill-editor-1280x800.png') })

    expect(rendererErrors).toEqual([])
  } catch (error) {
    bodyFailed = true
    throw error
  } finally {
    try {
      await closeEditor(application)
    } catch (error) {
      if (!bodyFailed) throw error
      console.warn(`Editor cleanup failed after the visual test had already failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
})

async function launchEditor(name: string): Promise<ElectronApplication> {
  const userData = path.resolve('test-results', `user-data-${name}`)
  await fs.mkdir(userData, { recursive: true })
  return electron.launch({
    args: [path.resolve('out', 'main', 'index.js')],
    env: { ...process.env, PHASER_EDITOR_USER_DATA: userData, PHASER_SOURCE_ROOT: 'I:\\Phaser\\phaser' },
    timeout: 20_000
  })
}

async function closeEditor(application: ElectronApplication): Promise<void> {
  const editorProcess = application.process()
  if (hasExited(editorProcess)) return

  const cleanupErrors: unknown[] = []
  const gracefulError = await boundedAttempt(application.evaluate(({ app }) => {
    setImmediate(() => app.exit(0))
  }), 3_000, 'Timed out requesting graceful Electron shutdown.')
  if (gracefulError) cleanupErrors.push(gracefulError)
  if (await waitForExit(editorProcess, 5_000)) return

  const closeError = await boundedAttempt(application.close(), 5_000, 'ElectronApplication.close() timed out.')
  if (closeError) cleanupErrors.push(closeError)
  if (await waitForExit(editorProcess, 2_000)) return

  const terminateError = await terminateProcessTree(editorProcess)
  if (terminateError) cleanupErrors.push(terminateError)
  if (await waitForExit(editorProcess, 5_000)) return

  const reasons = cleanupErrors.map((error) => error instanceof Error ? error.message : String(error)).join(' ')
  throw new Error(`Electron process ${String(editorProcess.pid)} did not exit after graceful and forced cleanup.${reasons ? ` ${reasons}` : ''}`)
}

async function terminateProcessTree(child: ChildProcess): Promise<unknown | null> {
  if (hasExited(child)) return null
  const pid = child.pid
  if (!pid) {
    try {
      child.kill('SIGKILL')
      return null
    } catch (error) {
      return error
    }
  }
  if (process.platform !== 'win32') {
    try {
      child.kill('SIGKILL')
      return null
    } catch (error) {
      return error
    }
  }

  try {
    const taskkill = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    if (!await waitForExit(taskkill, 5_000)) taskkill.kill()
    return null
  } catch (error) {
    return error
  }
}

async function boundedAttempt(promise: Promise<unknown>, timeout: number, message: string): Promise<unknown | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout)
      })
    ])
    return null
  } catch (error) {
    return error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', exited)
      resolve(false)
    }, timeout)
    const exited = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', exited)
  })
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

async function resizeWindow(application: ElectronApplication, width: number, height: number): Promise<void> {
  await application.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
  }, { width, height })
}

async function openProjectFromCenter(page: Page, projectPath: string): Promise<void> {
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Open Phaser project' })
  await dialog.getByLabel('Project folder').fill(projectPath)
  await dialog.getByRole('button', { name: 'Open project', exact: true }).click()
}

async function openProjectFile(page: Page, fileName: string): Promise<void> {
  const projectPanel = page.getByRole('tabpanel', { name: 'Project' })
  const search = projectPanel.getByLabel('Search project files')
  await search.fill(fileName)
  const row = projectPanel.getByRole('option', { name: new RegExp(`^${escapeRegExp(fileName)}\\b`) })
  await expect(row).toBeVisible()
  await row.dblclick()
  await search.fill('')
}

async function projectPluginState(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const result = await window.editorApi.plugins.list()
    if (!result.ok) throw new Error(result.error.message)
    return result.value.find((plugin) => plugin.manifest.id === 's3-skill-editor')?.build.state ?? null
  })
}

async function expectHostDocumentClean(page: Page, fileName: string): Promise<void> {
  await expect(page.getByRole('tab', { name: fileName, exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: `* ${fileName}`, exact: true })).toHaveCount(0)

  const hostInspector = page.getByRole('tabpanel', { name: 'Inspector' })
  const documentSection = hostInspector.locator('.inspector-section').filter({ hasText: 'Document' })
  const stateField = documentSection.locator('.property-row').filter({ hasText: 'State' })
  await expect(stateField.locator('strong')).toHaveText('Saved')
}

async function editorLayout(editor: import('@playwright/test').Locator): Promise<{
  overlaps: boolean
  overflowX: boolean
  overflowY: boolean
}> {
  return editor.evaluate((root) => {
    const rect = (selector: string): DOMRect => root.querySelector(selector)!.getBoundingClientRect()
    const hierarchy = rect('.hierarchy-pane')
    const center = rect('.center-pane')
    const inspector = rect('.inspector-pane')
    const overlaps = hierarchy.right > center.left + 0.5 || center.right > inspector.left + 0.5
    return {
      overlaps,
      overflowX: root.scrollWidth > root.clientWidth + 1,
      overflowY: root.scrollHeight > root.clientHeight + 1
    }
  })
}

async function spineCanvasHasRenderedPixels(
  canvas: import('@playwright/test').Locator
): Promise<boolean> {
  await expect(canvas).toBeVisible()
  return canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement
    const gl = target.getContext('webgl')
    if (!gl) return false
    const pixels = new Uint8Array(target.width * target.height * 4)
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let visible = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if ((pixels[index + 3] ?? 0) > 8 && ((pixels[index] ?? 0) + (pixels[index + 1] ?? 0) + (pixels[index + 2] ?? 0)) > 12) visible += 1
    }
    return visible > 100
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
