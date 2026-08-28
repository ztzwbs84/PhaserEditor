import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const screenshotRoot = path.resolve('artifacts', 'screenshots', 'project-plugin')

test.beforeAll(async () => {
  await fs.mkdir(screenshotRoot, { recursive: true })
})

test('loads a trusted project plugin editor and unloads it when switching projects', async () => {
  test.setTimeout(120_000)
  const runId = `${Date.now()}-${process.pid}`
  const fixtureRoot = path.resolve('test-results', `project-plugin-e2e-${runId}`)
  const pluginProject = path.join(fixtureRoot, 'plugin-project')
  const plainProject = path.join(fixtureRoot, 'plain-project')
  const actionRelativePath = path.join('migration', 'actions', 'action.json')
  const pluginActionPath = path.join(pluginProject, actionRelativePath)
  const plainActionPath = path.join(plainProject, actionRelativePath)
  await writeProject(pluginProject, true)
  await writeProject(plainProject, false)

  const application = await launchEditor(`project-plugin-${runId}`)
  const rendererErrors: string[] = []
  let page: Page | null = null
  try {
    page = await application.firstWindow()
    page.on('pageerror', (error) => rendererErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push(message.text())
    })
    await resizeWindow(application, 1280, 800)

    await openProjectFromCenter(page, pluginProject)
    const trustDialog = page.getByRole('alertdialog', { name: 'Trust project plugins?' })
    await expect(trustDialog).toBeVisible()
    await expect(trustDialog).toContainText('Fixture Project Plugin')
    await expect(trustDialog).toContainText('filesystem:project')
    await page.screenshot({ path: path.join(screenshotRoot, 'project-plugin-trust-1280x800.png') })
    await trustDialog.getByRole('button', { name: 'Trust and load' }).click()

    await expect(page.locator('.project-title')).toContainText('plugin-project')
    await expect.poll(() => getProjectPlugin(page!)).toMatchObject({
      enabled: true,
      state: 'active',
      scope: 'project',
      build: { state: 'ready' }
    })
    const installed = await getProjectPlugin(page)
    expect(installed?.instanceId).toMatch(/^project:[a-f0-9]{12}:fixture-project-plugin$/)
    expect(installed?.uiUrl).toMatch(/^phaser-plugin:\/\/local\/project%3A[a-f0-9]{12}%3Afixture-project-plugin\/[a-f0-9]{16}\/ui\.js$/)
    await expect.poll(() => page!.evaluate(() => (window as Window & { __fixturePluginImported?: number }).__fixturePluginImported ?? 0)).toBe(0)

    await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Fixture Overview' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Fixture Overview' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await openProjectFile(page, 'action.json')
    const shadowHost = page.locator('.lazy-plugin-surface[data-plugin="fixture-project-plugin"] .plugin-shadow-host')
    await expect(shadowHost).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => shadowHost.evaluate((element) => Boolean(element.shadowRoot))).toBe(true)
    const editor = shadowHost.locator('[data-testid="fixture-editor"]')
    await expect(editor).toBeVisible()
    await expect(editor.getByRole('heading', { name: 'Project Plugin Timeline' })).toBeVisible()
    await expect(editor.locator('[data-testid="fixture-value"]')).toHaveText('0')
    await expect.poll(() => page!.evaluate(() => (window as Window & { __fixturePluginImported?: number }).__fixturePluginImported ?? 0)).toBe(1)
    await expect.poll(() => editor.evaluate((element) => getComputedStyle(element).borderLeftColor)).toBe('rgb(17, 85, 153)')

    const protocolResponse = await page.evaluate(async (url) => {
      const response = await fetch(url)
      return {
        ok: response.ok,
        type: response.headers.get('content-type'),
        source: await response.text()
      }
    }, installed!.uiUrl!)
    expect(protocolResponse).toMatchObject({ ok: true, type: 'text/javascript; charset=utf-8' })
    expect(protocolResponse.source).toContain('Project Plugin Timeline')

    await editor.getByRole('button', { name: 'Increment value' }).click()
    await expect(editor.locator('[data-testid="fixture-value"]')).toHaveText('1')
    await expect(page.getByRole('tab', { name: /action\.json/ })).toContainText('*')

    await page.keyboard.press('Control+z')
    await expect(editor.locator('[data-testid="fixture-value"]')).toHaveText('0')
    await page.keyboard.press('Control+Shift+z')
    await expect(editor.locator('[data-testid="fixture-value"]')).toHaveText('1')
    await page.keyboard.press('Control+s')
    await expect(page.getByRole('tab', { name: 'action.json', exact: true })).toBeVisible()
    await expect.poll(async () => JSON.parse(await fs.readFile(pluginActionPath, 'utf8')).value).toBe(1)
    await expect(editor.locator('[data-testid="fixture-save-count"]')).toHaveText('1')
    await page.screenshot({ path: path.join(screenshotRoot, 'project-plugin-editor-1280x800.png') })

    await closeProject(page)
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    await expect.poll(() => page!.evaluate(() => (window as Window & { __fixturePluginDisposed?: number }).__fixturePluginDisposed ?? 0)).toBe(1)
    await expect.poll(async () => (await listPlugins(page!)).some((plugin) => plugin.scope === 'project')).toBe(false)

    await openProjectFromCenter(page, plainProject)
    await expect(page.locator('.project-title')).toContainText('plain-project')
    await expect(page.getByRole('alertdialog', { name: 'Trust project plugins?' })).toHaveCount(0)
    await openProjectFile(page, 'action.json')
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.lazy-plugin-surface[data-plugin="fixture-project-plugin"]')).toHaveCount(0)
    await expect(fs.readFile(plainActionPath, 'utf8')).resolves.toContain('"value": 0')
    await page.screenshot({ path: path.join(screenshotRoot, 'project-plugin-unloaded-1280x800.png') })

    expect(rendererErrors).toEqual([])
  } finally {
    await closeEditor(application)
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
  const closed = application.waitForEvent('close', { timeout: 15_000 })
  await application.evaluate(({ app }) => {
    setImmediate(() => app.exit(0))
  })
  await closed
}

async function resizeWindow(application: ElectronApplication, width: number, height: number): Promise<void> {
  await application.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
  }, { width, height })
}

async function openProjectFromCenter(page: Page, projectPath: string): Promise<void> {
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Open Phaser project' })
  await expect(dialog).toBeVisible()
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

async function closeProject(page: Page): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Close Project', exact: true }).click()
}

async function listPlugins(page: Page): Promise<Array<{ scope: string }>> {
  return page.evaluate(async () => {
    const result = await window.editorApi.plugins.list()
    if (!result.ok) throw new Error(result.error.message)
    return result.value.map((plugin) => ({ scope: plugin.scope }))
  })
}

async function getProjectPlugin(page: Page): Promise<{
  instanceId: string
  uiUrl?: string
  enabled: boolean
  state: string
  scope: string
  build: { state: string }
} | null> {
  return page.evaluate(async () => {
    const result = await window.editorApi.plugins.list()
    if (!result.ok) throw new Error(result.error.message)
    const plugin = result.value.find((candidate) => candidate.manifest.id === 'fixture-project-plugin')
    return plugin ? {
      instanceId: plugin.instanceId,
      uiUrl: plugin.uiUrl,
      enabled: plugin.enabled,
      state: plugin.state,
      scope: plugin.scope,
      build: { state: plugin.build.state }
    } : null
  })
}

async function writeProject(projectRoot: string, includePlugin: boolean): Promise<void> {
  const actionDirectory = path.join(projectRoot, 'migration', 'actions')
  await fs.mkdir(actionDirectory, { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'package.json'), `${JSON.stringify({
    name: includePlugin ? 'plugin-project' : 'plain-project',
    dependencies: { phaser: '4.2.1' }
  }, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(actionDirectory, 'action.json'), '{\n  "value": 0\n}\n', 'utf8')
  if (!includePlugin) return

  const pluginRoot = path.join(projectRoot, '.phaser-editor', 'plugins', 'fixture-project-plugin')
  await fs.mkdir(path.join(pluginRoot, 'src'), { recursive: true })
  await fs.writeFile(path.join(pluginRoot, 'plugin.json'), `${JSON.stringify({
    id: 'fixture-project-plugin',
    name: 'Fixture Project Plugin',
    version: '1.0.0',
    engine: '>=0.1.0',
    apiVersion: 1,
    uiSource: 'src/index.ts',
    permissions: ['filesystem:project'],
    contributes: {
      commands: [{ id: 'fixture.openOverview', title: 'Open Fixture Overview' }],
      panels: [{ id: 'fixture-overview', title: 'Fixture Overview', entry: 'fixtureOverview' }],
      fileHandlers: [{
        id: 'fixture-action',
        fileMatch: ['migration/actions/*.json'],
        editor: 'fixtureActionEditor',
        priority: 100
      }]
    }
  }, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(pluginRoot, 'src', 'style.css'), [
    '[data-testid="fixture-editor"] {',
    '  height: 100%;',
    '  padding: 20px;',
    '  border-left: 4px solid rgb(17, 85, 153);',
    '  background: rgb(28, 31, 36);',
    '  color: rgb(240, 244, 248);',
    '}',
    '[data-testid="fixture-editor"] button { margin-right: 8px; }',
    ''
  ].join('\n'), 'utf8')
  await fs.writeFile(path.join(pluginRoot, 'src', 'index.ts'), pluginSource(), 'utf8')
}

function pluginSource(): string {
  return `import './style.css'

const pluginWindow = window as Window & {
  __fixturePluginImported?: number
  __fixturePluginMounted?: number
  __fixturePluginDisposed?: number
}

pluginWindow.__fixturePluginImported = (pluginWindow.__fixturePluginImported ?? 0) + 1

function createSurface(title: string) {
  return {
    mount(container: HTMLElement, initialContext: any) {
      let context = initialContext
      let current = context.document?.snapshot.content ?? '{"value":0}'
      const undoStack: string[] = []
      const redoStack: string[] = []
      let saveCount = 0
      pluginWindow.__fixturePluginMounted = (pluginWindow.__fixturePluginMounted ?? 0) + 1
      container.innerHTML = \`<main data-testid="fixture-editor">
        <h1>\${title}</h1>
        <p>Value: <output data-testid="fixture-value"></output></p>
        <p>Saves: <output data-testid="fixture-save-count"></output></p>
        <button type="button" data-testid="fixture-increment">Increment value</button>
      </main>\`
      const root = container.querySelector('[data-testid="fixture-editor"]') as HTMLElement
      const value = root.querySelector('[data-testid="fixture-value"]') as HTMLOutputElement
      const saves = root.querySelector('[data-testid="fixture-save-count"]') as HTMLOutputElement
      const render = () => {
        value.value = String(JSON.parse(current).value)
        saves.value = String(saveCount)
      }
      const publish = (next: string) => {
        current = next
        context.document?.update(next)
        render()
      }
      const commitValue = (nextValue: number) => {
        undoStack.push(current)
        redoStack.length = 0
        publish(JSON.stringify({ value: nextValue }, null, 2) + '\\n')
      }
      const increment = () => commitValue(Number(JSON.parse(current).value) + 1)
      root.querySelector('[data-testid="fixture-increment"]')?.addEventListener('click', increment)
      const unregisterHistory = context.history.registerActiveUndoRedo({
        undo() {
          const previous = undoStack.pop()
          if (previous === undefined) return
          redoStack.push(current)
          publish(previous)
        },
        redo() {
          const next = redoStack.pop()
          if (next === undefined) return
          undoStack.push(current)
          publish(next)
        },
        canUndo: () => undoStack.length > 0,
        canRedo: () => redoStack.length > 0
      })
      const unsubscribeDocument = context.document?.subscribe((document: any) => {
        if (document.content === current) return
        current = document.content
        render()
      })
      const unsubscribeSave = context.document?.onDidSave(() => {
        saveCount += 1
        render()
      })
      render()
      return {
        update(nextContext: any) {
          context = nextContext
        },
        dispose() {
          root.querySelector('[data-testid="fixture-increment"]')?.removeEventListener('click', increment)
          unregisterHistory()
          unsubscribeDocument?.()
          unsubscribeSave?.()
          container.replaceChildren()
          pluginWindow.__fixturePluginDisposed = (pluginWindow.__fixturePluginDisposed ?? 0) + 1
        }
      }
    }
  }
}

export const fixtureActionEditor = createSurface('Project Plugin Timeline')
export const fixtureOverview = createSurface('Fixture Overview')
export const commands = {
  'fixture.openOverview': (context: any) => context.openPanel('fixture-overview')
}
`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
