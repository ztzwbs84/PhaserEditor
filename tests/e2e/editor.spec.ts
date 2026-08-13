import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { ANIMATION_ASSET_FORMAT, CURRENT_ANIMATION_ASSET_VERSION, createSceneDocument, createSceneTransform, serializeAnimationAsset, serializeSceneDocument, type AnimationAsset, type SceneDocument } from '@phaser-editor/contracts'

const screenshotRoot = path.resolve('artifacts', 'screenshots')

test.beforeAll(async () => {
  await Promise.all(Array.from({ length: 9 }, (_, index) => fs.mkdir(path.join(screenshotRoot, `phase-${index + 1}`), { recursive: true })))
})

test('project center boots through the secure preload bridge', async () => {
  const application = await launchEditor('project-center')
  try {
    const page = await application.firstWindow()
    await resizeWindow(application, 1280, 720)
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open project' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible()
    expect(await page.evaluate(() => typeof window.editorApi?.project?.listRecent)).toBe('function')
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-2', 'project-center-1280x720.png') })

    await page.getByRole('button', { name: 'Open project' }).click()
    await expect(page.getByRole('dialog', { name: 'Open Phaser project' })).toBeVisible()
    await page.getByLabel('Project folder').fill('I:\\Phaser\\examples-master\\examples-master')
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-2', 'open-project-dialog-1280x720.png') })
    await page.getByRole('button', { name: 'Cancel' }).click()

    await page.getByRole('button', { name: 'New project' }).click()
    await expect(page.getByRole('dialog', { name: 'Create Phaser project' })).toBeVisible()
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-2', 'create-project-dialog-1280x720.png') })
    await page.getByRole('button', { name: 'Cancel' }).click()
  } finally {
    await closeEditor(application)
  }
})

test('opens and runs the Phaser examples repository with an interactive console', async () => {
  test.setTimeout(90_000)
  const examplesRoot = 'I:\\Phaser\\examples-master\\examples-master'
  const previewPort = 8080
  const application = await launchEditor(`examples-${Date.now()}`)
  let page: Page | null = null
  try {
    page = await application.firstWindow()
    await resizeWindow(application, 1280, 720)
    await page.getByRole('button', { name: 'Open project', exact: true }).click()
    const openDialog = page.getByRole('dialog', { name: 'Open Phaser project' })
    await openDialog.getByLabel('Project folder').fill(examplesRoot)
    await openDialog.getByRole('button', { name: 'Open project', exact: true }).click()
    await expect(page.locator('.project-title')).toContainText('phaser3-examples')
    await expect(page.getByText(examplesRoot, { exact: true })).toBeVisible()

    await expect(page.getByLabel('Executable')).toHaveValue('yarn')
    await expect(page.getByLabel('Arguments')).toHaveValue('run start')

    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByTitle('Run project').click()
    await expect(page.locator('.run-badge')).toHaveAttribute('title', /Running|Error/, { timeout: 15_000 })
    if (await page.locator('.run-badge').getAttribute('title') === 'Error') {
      throw new Error(`Examples runner failed:\n${(await page.locator('.log-message').allTextContents()).join('\n')}`)
    }
    await page.getByRole('tab', { name: 'Game', exact: true }).click()
    await expect(page.locator('.preview-state')).toContainText(`http://127.0.0.1:${previewPort}`, { timeout: 15_000 })

    await expect.poll(() => application.evaluate(({ webContents }, port) => {
      return webContents.getAllWebContents().some((contents) => contents.getURL().startsWith(`http://127.0.0.1:${port}`))
    }, previewPort), { timeout: 15_000 }).toBe(true)
    const injected = await application.evaluate(async ({ webContents }) => {
      const preview = webContents.getAllWebContents().find((contents) => /^http:\/\/127\.0\.0\.1:\d+/.test(contents.getURL()))
      if (!preview) return false
      await preview?.executeJavaScript("console.info('preview-console-captured')")
      return true
    })
    expect(injected).toBe(true)
    await expect.poll(() => application.evaluate(async ({ webContents }) => {
      const preview = webContents.getAllWebContents().find((contents) => /^http:\/\/127\.0\.0\.1:\d+/.test(contents.getURL()))
      if (!preview) return false
      return preview.executeJavaScript("document.readyState === 'complete' && Array.from(document.images).every((image) => image.complete)")
    }), { timeout: 15_000 }).toBe(true)
    await page.waitForTimeout(250)
    const previewPng = await application.evaluate(async ({ webContents }) => {
      const preview = webContents.getAllWebContents().find((contents) => /^http:\/\/127\.0\.0\.1:\d+/.test(contents.getURL()))
      return preview ? (await preview.capturePage()).toPNG().toString('base64') : null
    })
    expect(previewPng).not.toBeNull()
    await fs.writeFile(path.join(screenshotRoot, 'phase-4', 'examples-preview-electron.png'), Buffer.from(previewPng!, 'base64'))
    await page.getByRole('tab', { name: 'Console', exact: true }).click()
    await expect(page.getByText('preview-console-captured', { exact: true })).toBeVisible({ timeout: 10_000 })
    await page.getByLabel('Process input').fill('h')
    await page.getByLabel('Process input').press('Enter')
    await expect(page.getByText('> h', { exact: true })).toBeVisible()
    await expect(page.locator('.notice')).toHaveCount(0, { timeout: 7_000 })
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-4', 'examples-console-electron-1280x720.png') })

    await page.getByTitle('Stop project').click()
    await expect(page.locator('.run-badge')).toHaveAttribute('title', 'Stopped', { timeout: 10_000 })
  } finally {
    if (page) await page.evaluate(() => window.editorApi.runner.stop()).catch(() => undefined)
    await closeEditor(application)
  }
})

test('creates, edits, runs and previews a Phaser project', async () => {
  test.setTimeout(120_000)
  const runId = `${Date.now()}-${process.pid}`
  const parentDirectory = path.resolve('test-results', `项目 验收 ${runId}`)
  const projectName = 'Commercial Demo'
  const packageName = 'commercial-demo'
  const targetDirectory = path.join(parentDirectory, projectName)
  await fs.mkdir(parentDirectory, { recursive: true })

  const application = await launchEditor(`workspace-${runId}`)
  const rendererErrors: string[] = []
  let page: Page | null = null
  try {
    page = await application.firstWindow()
    page.on('pageerror', (error) => rendererErrors.push(error.message))
    await resizeWindow(application, 1280, 720)

    await page.getByRole('button', { name: 'New project' }).click()
    await page.getByLabel('Project name').fill(projectName)
    await page.getByLabel('Parent folder').fill(parentDirectory)
    await page.getByLabel('Target directory').fill(targetDirectory)
    await page.getByRole('button', { name: 'Create project' }).click()

    await expect(page.getByRole('tab', { name: 'Scene' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.project-title')).toContainText(packageName)
    await expect(fs.stat(path.join(targetDirectory, 'package.json'))).resolves.toBeDefined()
    await writeProjectFixtures(targetDirectory)
    await page.getByRole('tabpanel', { name: 'Project' }).getByTitle('Refresh Project').click()
    const projectPanel = page.getByRole('tabpanel', { name: 'Project' })
    await expect(projectPanel.locator('.project-folder-pane [data-kind="file"]')).toHaveCount(0)
    const assetFolder = projectPanel.getByTestId('project-file-pane').getByRole('option', { name: 'assets', exact: true })
    await expect(assetFolder).toHaveAttribute('data-kind', 'directory')
    await expect(projectPanel.getByRole('option', { name: 'package.json', exact: true })).toBeVisible()

    await assetFolder.dblclick()
    await expect(projectPanel.getByRole('option', { name: 'scene-map.json', exact: true })).toBeVisible()
    await expect(projectPanel.getByRole('navigation', { name: 'Current project folder' })).toContainText('assets')

    await expandAssetDirectory(page, 'assets')
    await expect(projectPanel.getByRole('option', { name: 'scene-map.json', exact: true })).toBeVisible()
    await expect(projectPanel.getByRole('navigation', { name: 'Current project folder' })).toContainText('assets')
    await projectPanel.getByRole('button', { name: packageName, exact: true }).click()
    await expect(projectPanel.getByRole('option', { name: 'package.json', exact: true })).toBeVisible()

    const projectSearch = projectPanel.getByLabel('Search project files')
    await projectSearch.fill('scene-map')
    await expect(projectPanel.getByRole('option', { name: /scene-map\.json/ })).toBeVisible()
    await projectSearch.fill('')

    const splitter = projectPanel.getByTestId('project-splitter')
    const beforeSplit = await projectPanel.getByTestId('project-folder-pane').boundingBox()
    const splitBounds = await splitter.boundingBox()
    if (!beforeSplit || !splitBounds) throw new Error('Project split panes are not measurable.')
    await page.mouse.move(splitBounds.x + splitBounds.width / 2, splitBounds.y + 20)
    await page.mouse.down()
    await page.mouse.move(splitBounds.x + 40, splitBounds.y + 20)
    await page.mouse.up()
    const afterSplit = await projectPanel.getByTestId('project-folder-pane').boundingBox()
    expect(afterSplit?.width).toBeGreaterThan(beforeSplit.width + 20)
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-2', 'opened-project-workspace-1280x720.png') })

    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: /^Save\s+Ctrl\+S$/ })).toBeVisible()
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-1', 'menu-and-default-workspace-1280x720.png') })
    await page.keyboard.press('Escape')

    await openAsset(page, 'package.json')
    await openAsset(page, 'README.md')
    await expect(page.getByRole('button', { name: 'Source', exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-3', 'assets-and-document-tabs-1280x720.png') })
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-5', 'markdown-split-preview-1280x720.png') })

    await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Toggle Theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-1', 'light-theme-1280x720.png') })
    await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Toggle Theme' }).click()

    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByTitle('Run project').click()
    await expect(page.locator('.run-badge')).toHaveAttribute('title', /Running|Error/, { timeout: 15_000 })
    if (await page.locator('.run-badge').getAttribute('title') === 'Error') {
      throw new Error(`Project runner failed:\n${(await page.locator('.log-message').allTextContents()).join('\n')}`)
    }
    await page.getByRole('tab', { name: 'Game', exact: true }).first().click()
    await expect(page.locator('.preview-state')).toContainText('http://127.0.0.1:', { timeout: 15_000 })
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-4', 'running-preview-1280x720.png') })
    await page.getByRole('tab', { name: 'Console', exact: true }).first().click()
    await expect(page.getByText(/Local:\s+http:\/\/127\.0\.0\.1:/)).toBeVisible()
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-4', 'structured-run-log-1280x720.png') })
    await page.getByTitle('Stop project').click()
    await expect(page.locator('.run-badge')).toHaveAttribute('title', 'Stopped', { timeout: 10_000 })

    await expandAssetDirectory(page, 'assets')
    await openAsset(page, 'tiles.png')
    await expect(page.getByText('64 × 64')).toBeVisible()
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-6', 'image-viewer-1280x720.png') })
    assertNoRendererErrors(rendererErrors, 'image viewer')

    await openAsset(page, 'tone.wav')
    await expect(page.getByRole('heading', { name: 'tone.wav' })).toBeVisible()
    await expect(page.locator('.waveform canvas').first()).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-6', 'audio-viewer-1280x720.png') })
    assertNoRendererErrors(rendererErrors, 'audio viewer')

    await openAsset(page, 'scene-map.json')
    await expect(page.getByTitle('Brush')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.phaser-map-host canvas').first()).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-7', 'tilemap-editor-1280x720.png') })
    assertNoRendererErrors(rendererErrors, 'tilemap editor')

    await openAsset(page, 'tiles.phaser-atlas.json')
    await expect(page.getByRole('listbox', { name: 'Atlas frames' }).getByRole('option')).toHaveCount(4)
    await page.getByRole('option', { name: /gold/ }).click()
    await expect(page.locator('.frame-detail-strip')).toContainText('gold')
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-3', 'atlas-inspector-electron.png') })

    await openAsset(page, 'tiles.phaser-animations.json')
    await expect(page.getByRole('listbox', { name: 'Animation clips' })).toContainText('tiles-cycle')
    await page.getByLabel('Key').fill('tiles-edited')
    await page.getByLabel('Key').press('Enter')
    await page.keyboard.press('Control+z')
    await expect(page.getByLabel('Key')).toHaveValue('tiles-cycle')
    await page.keyboard.press('Control+Shift+z')
    await expect(page.getByLabel('Key')).toHaveValue('tiles-edited')
    await page.keyboard.press('Control+s')
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-3', 'animation-editor-electron.png') })
    assertNoRendererErrors(rendererErrors, 'atlas and animation editors')

    await page.getByRole('tab', { name: 'Palette', exact: true }).first().click()
    await expect(page.getByText('HEX', { exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-8', 'palette-panel-1280x720.png') })

    await page.getByRole('menubar').getByRole('menuitem', { name: 'Tools', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Plugins...' }).click()
    await expect(page.getByRole('dialog')).toContainText('Local trusted extensions')
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-9', 'plugin-manager-1280x720.png') })
    await page.getByTitle('Close plugin manager').click()

    for (const size of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await resizeWindow(application, size.width, size.height)
      await page.waitForTimeout(250)
      await page.screenshot({ path: path.join(screenshotRoot, 'phase-9', `final-workspace-${size.width}x${size.height}.png`) })
      expect(await hasOverflow(page)).toBe(false)
    }

    expect(rendererErrors).toEqual([])
  } finally {
    if (page) await page.evaluate(() => window.editorApi.runner.stop()).catch(() => undefined)
    await closeEditor(application)
  }
})

test('saves, closes, and reopens a visual scene without losing its rendered model', async () => {
  test.setTimeout(90_000)
  const runId = `scene-${Date.now()}-${process.pid}`
  const parentDirectory = path.resolve('test-results', runId)
  const targetDirectory = path.join(parentDirectory, 'Scene Round Trip')
  await fs.mkdir(parentDirectory, { recursive: true })
  const application = await launchEditor(runId)
  let page: Page | null = null
  try {
    page = await application.firstWindow()
    await resizeWindow(application, 1280, 720)
    await page.getByRole('button', { name: 'New project' }).click()
    await page.getByLabel('Project name').fill('Scene Round Trip')
    await page.getByLabel('Parent folder').fill(parentDirectory)
    await page.getByLabel('Target directory').fill(targetDirectory)
    await page.getByRole('button', { name: 'Create project' }).click()

    await writeSceneFixture(targetDirectory)
    const projectPanel = page.getByRole('tabpanel', { name: 'Project' })
    await projectPanel.getByTitle('Refresh Project').click()
    await expandAssetDirectory(page, 'assets')
    await expandAssetDirectory(page, 'Scenes')
    await openAsset(page, 'MainScene.phaser-scene.json')
    await expect(page.getByTestId('scene-phaser-host').locator('canvas')).toBeVisible()
    await page.locator('.scene-object-row').filter({ hasText: 'Title' }).click()
    await expect(page.getByLabel('Position X')).toHaveValue('360')
    await page.getByLabel('Position X').fill('444')
    await page.getByLabel('Position X').press('Enter')
    await page.keyboard.press('Control+s')
    await expect(page.getByRole('tab', { name: 'MainScene.phaser-scene.json', exact: true })).toBeVisible()

    await page.locator('.scene-object-row').filter({ hasText: 'World' }).click()
    await page.getByLabel('Component type').selectOption('phaser.camera')
    await page.getByTitle('Add component').click()
    await page.locator('.scene-object-row').filter({ hasText: 'Body' }).click()
    for (const type of ['phaser.arcade-body', 'phaser.matter-body', 'phaser.particle-emitter', 'phaser.tween']) {
      await page.getByLabel('Component type').selectOption(type)
      await page.getByTitle('Add component').click()
    }
    await page.getByLabel('Texture').fill('assets/body.png')
    await page.getByLabel('Texture').press('Enter')
    await page.getByLabel('To', { exact: true }).fill('240')
    await page.getByLabel('To', { exact: true }).press('Enter')
    await page.keyboard.press('Control+s')

    const tabButton = page.locator('.flexlayout__tab_button').filter({ hasText: 'MainScene.phaser-scene.json' })
    await tabButton.locator('.flexlayout__tab_button_trailing').click()
    await expect(tabButton).toHaveCount(0)
    await openAsset(page, 'MainScene.phaser-scene.json')
    await page.locator('.scene-object-row').filter({ hasText: 'Title' }).click()
    await expect(page.getByLabel('Position X')).toHaveValue('444')
    await expect(page.locator('.scene-object-row')).toHaveCount(4)
    await expect(page.getByTestId('scene-phaser-host').locator('canvas')).toBeVisible()

    const persisted = JSON.parse(await fs.readFile(path.join(targetDirectory, 'assets', 'Scenes', 'MainScene.phaser-scene.json'), 'utf8')) as SceneDocument
    expect(persisted.objects.find((object) => object.name === 'Title')?.transform.x).toBe(444)
    expect(persisted.objects.find((object) => object.name === 'Body')?.components.map((component) => component.type)).toEqual(['phaser.arcade-body', 'phaser.matter-body', 'phaser.particle-emitter', 'phaser.tween'])
    const dismissNotices = page.getByRole('button', { name: 'Dismiss notification' })
    while (await dismissNotices.count()) await dismissNotices.first().click()
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-2', 'visual-scene-round-trip-electron.png') })
    await page.locator('.scene-object-row').filter({ hasText: 'Body' }).click()
    await expect(page.locator('.scene-component')).toHaveCount(4)
    await page.screenshot({ path: path.join(screenshotRoot, 'phase-3', 'gameplay-components-electron.png') })
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
    setImmediate(() => app.quit())
  })
  await closed
}

async function resizeWindow(application: ElectronApplication, width: number, height: number): Promise<void> {
  await application.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
  }, { width, height })
}

async function openAsset(page: Page, name: string): Promise<void> {
  const row = page.getByRole('option', { name, exact: true })
  await expect(row).toBeVisible()
  await row.dblclick()
}

async function expandAssetDirectory(page: Page, name: string): Promise<void> {
  const row = page.getByRole('treeitem', { name: new RegExp(name) }).first()
  await expect(row).toBeVisible()
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.locator('.tree-chevron').click()
  await row.click()
}

async function hasOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth || document.documentElement.scrollHeight > document.documentElement.clientHeight)
}

async function writeProjectFixtures(projectRoot: string): Promise<void> {
  const assets = path.join(projectRoot, 'assets')
  await fs.mkdir(assets, { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'README.md'), [
    '# Commercial Demo',
    '',
    '## Editor acceptance',
    '',
    '| Surface | Status |',
    '| --- | --- |',
    '| Markdown preview | Ready |',
    '| Phaser runtime | Ready |',
    '',
    '> This document is rendered inside the editor.',
    '',
    '```ts',
    'const framework = "Phaser 4.2.1"',
    '```',
    ''
  ].join('\n'), 'utf8')
  await fs.writeFile(path.join(assets, 'tiles.png'), createTilesetPng())
  const atlas = {
    frames: {
      blue: { frame: { x: 0, y: 0, w: 32, h: 32 }, rotated: false, trimmed: false },
      green: { frame: { x: 32, y: 0, w: 32, h: 32 }, rotated: false, trimmed: false },
      gold: { frame: { x: 0, y: 32, w: 32, h: 32 }, rotated: false, trimmed: false },
      rose: { frame: { x: 32, y: 32, w: 32, h: 32 }, rotated: false, trimmed: false }
    },
    meta: { image: 'tiles.png', size: { w: 64, h: 64 }, scale: 1 }
  }
  await fs.writeFile(path.join(assets, 'tiles.phaser-atlas.json'), `${JSON.stringify(atlas, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(assets, 'tiles.phaser-spritesheet.json'), `${JSON.stringify({ image: 'tiles.png', imageWidth: 64, imageHeight: 64, frameWidth: 32, frameHeight: 32, margin: 0, spacing: 0 }, null, 2)}\n`, 'utf8')
  const animationAsset: AnimationAsset = {
    format: ANIMATION_ASSET_FORMAT,
    version: CURRENT_ANIMATION_ASSET_VERSION,
    clips: [{
      id: '6a7d67ea-29e0-4ac7-94f7-78cb4f70dc39',
      key: 'tiles-cycle',
      frames: ['blue', 'green', 'gold', 'rose'].map((frame) => ({ source: 'assets/tiles.phaser-atlas.json', frame })),
      frameRate: 4,
      duration: null,
      delay: 0,
      repeat: -1,
      repeatDelay: 0,
      yoyo: true,
      skipMissedFrames: true
    }]
  }
  await fs.writeFile(path.join(assets, 'tiles.phaser-animations.json'), serializeAnimationAsset(animationAsset), 'utf8')
  await fs.writeFile(path.join(assets, 'tone.wav'), createWavBuffer())

  const width = 24
  const height = 16
  const map = {
    compressionlevel: -1,
    height,
    width,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tileheight: 32,
    tilewidth: 32,
    type: 'map',
    version: '1.10',
    tiledversion: '1.11.2',
    nextlayerid: 3,
    nextobjectid: 2,
    layers: [
      { id: 1, name: 'Ground', type: 'tilelayer', width, height, x: 0, y: 0, opacity: 1, visible: true, data: Array.from({ length: width * height }, (_, index) => (index + Math.floor(index / width)) % 4 + 1) },
      { id: 2, name: 'Spawn Points', type: 'objectgroup', opacity: 1, visible: true, objects: [{ id: 1, name: 'Player', type: 'spawn', x: 288, y: 192, width: 32, height: 32 }] }
    ],
    tilesets: [{ columns: 2, firstgid: 1, image: 'tiles.png', imageheight: 64, imagewidth: 64, margin: 0, name: 'Acceptance', spacing: 0, tilecount: 4, tileheight: 32, tilewidth: 32 }]
  }
  await fs.writeFile(path.join(assets, 'scene-map.json'), `${JSON.stringify(map, null, 2)}\n`, 'utf8')
}

async function writeSceneFixture(projectRoot: string): Promise<void> {
  const scenes = path.join(projectRoot, 'assets', 'Scenes')
  await fs.mkdir(scenes, { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'assets', 'body.png'), createTilesetPng())
  const document: SceneDocument = {
    ...createSceneDocument('MainScene'),
    settings: { ...createSceneDocument('MainScene').settings, width: 960, height: 540 },
    objects: [
      { id: 'e4b3c75c-2bb8-4ead-a286-25695d456586', type: 'container', name: 'World', parentId: null, order: 0, transform: createSceneTransform(), visible: true, alpha: 1, components: [] },
      { id: '855170dc-d4f2-4dd5-b099-5006c2a5a318', type: 'text', name: 'Title', parentId: null, order: 1, transform: createSceneTransform({ x: 360, y: 120 }), visible: true, alpha: 1, components: [], text: 'Round Trip', style: { fontFamily: 'Arial', fontSize: 36, color: '#8fd3ff', align: 'center' } },
      { id: '70468d29-c159-4b6e-93cc-3cc63ebf6776', type: 'text', name: 'Status', parentId: 'e4b3c75c-2bb8-4ead-a286-25695d456586', order: 0, transform: createSceneTransform({ x: 120, y: 220 }), visible: true, alpha: 1, components: [], text: 'Saved', style: { fontFamily: 'Arial', fontSize: 20, color: '#ffffff', align: 'left' } },
      { id: '940d626c-4df7-43d3-a7b7-aa669b4969d4', type: 'sprite', name: 'Body', parentId: null, order: 2, transform: createSceneTransform({ x: 620, y: 320 }), visible: true, alpha: 1, components: [], asset: { path: 'assets/body.png', frame: null }, animation: null }
    ]
  }
  await fs.writeFile(path.join(scenes, 'MainScene.phaser-scene.json'), serializeSceneDocument(document), 'utf8')
}

function createTilesetPng(): Buffer {
  const width = 64
  const height = 64
  const colors = [[79, 143, 184], [101, 168, 93], [213, 161, 61], [166, 90, 117]]
  const stride = width * 4 + 1
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    pixels[row] = 0
    for (let x = 0; x < width; x += 1) {
      const color = colors[(x >= 32 ? 1 : 0) + (y >= 32 ? 2 : 0)]!
      const offset = row + 1 + x * 4
      pixels[offset] = color[0]!
      pixels[offset + 1] = color[1]!
      pixels[offset + 2] = color[2]!
      pixels[offset + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  name.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length)
  return chunk
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function createWavBuffer(): Buffer {
  const sampleRate = 8_000
  const sampleCount = 2_000
  const dataLength = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataLength)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataLength, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataLength, 40)
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 8_000), 44 + index * 2)
  }
  return buffer
}

function assertNoRendererErrors(errors: string[], stage: string): void {
  if (errors.length > 0) throw new Error(`Renderer errors after ${stage}: ${errors.join(', ')}`)
}
