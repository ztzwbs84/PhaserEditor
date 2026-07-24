import { test, expect, type Locator } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'

test('authors a scene through the web editor with synchronized surfaces', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:4174/')
  await page.getByText('browser-demo', { exact: true }).dblclick()
  await expect(page.getByRole('tab', { name: 'Scene', exact: true })).toBeVisible()

  const projectPanel = page.getByRole('tabpanel', { name: 'Project' })
  await openProjectFolder(projectPanel, 'assets')
  await openProjectFolder(projectPanel, 'Scenes')
  await projectPanel.getByRole('option', { name: 'MainScene.phaser-scene.json', exact: true }).dblclick()

  const canvas = page.getByTestId('scene-phaser-host').locator('canvas')
  await expect(canvas).toBeVisible()
  await expect.poll(() => canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext('2d')
    if (!context) return 0
    const pixels = context.getImageData(0, 0, Math.min(240, (element as HTMLCanvasElement).width), Math.min(180, (element as HTMLCanvasElement).height)).data
    let nonBlank = 0
    for (let index = 0; index < pixels.length; index += 16) if (pixels[index] !== 31 || pixels[index + 1] !== 36 || pixels[index + 2] !== 42) nonBlank += 1
    return nonBlank
  })).toBeGreaterThan(50)

  await page.locator('.scene-object-row').filter({ hasText: 'Title' }).click()
  await expect(page.getByLabel('Position X')).toHaveValue('360')
  await page.getByLabel('Position X').fill('500')
  await page.getByLabel('Position X').press('Enter')
  await expect(page.getByLabel('Position X')).toHaveValue('500')
  await expect(page.getByRole('tab', { name: '* MainScene.phaser-scene.json', exact: true })).toBeVisible()

  await page.keyboard.press('Control+z')
  await expect(page.getByLabel('Position X')).toHaveValue('360')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByLabel('Position X')).toHaveValue('500')

  await openProjectFolder(projectPanel, 'assets')
  const beforeDrop = await page.locator('.scene-object-row').count()
  await projectPanel.getByRole('option', { name: 'tiles.png', exact: true }).dragTo(page.getByTestId('scene-input-layer'))
  await expect(page.locator('.scene-object-row')).toHaveCount(beforeDrop + 1)
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('tab', { name: 'MainScene.phaser-scene.json', exact: true })).toBeVisible()

  await fs.mkdir(path.resolve('artifacts', 'screenshots', 'phase-2'), { recursive: true })
  await page.screenshot({ path: path.resolve('artifacts', 'screenshots', 'phase-2', 'visual-scene-editor-web.png') })
  expect(errors).toEqual([])
})

test('inspects atlas metadata and edits animation playback with undo and reopen', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:4174/')
  await page.getByText('browser-demo', { exact: true }).dblclick()
  const projectPanel = page.getByRole('tabpanel', { name: 'Project' })
  await openProjectFolder(projectPanel, 'assets')

  await projectPanel.getByRole('option', { name: 'tiles.phaser-atlas.json', exact: true }).dblclick()
  await expect(page.getByRole('listbox', { name: 'Atlas frames' }).getByRole('option')).toHaveCount(4)
  await page.getByRole('option', { name: /green/ }).click()
  await expect(page.locator('.frame-detail-strip')).toContainText('green')

  await openProjectFolder(projectPanel, 'Animations')
  await projectPanel.getByRole('option', { name: 'tiles.phaser-animations.json', exact: true }).dblclick()
  await expect(page.getByRole('listbox', { name: 'Animation clips' })).toContainText('tiles-cycle')
  const key = page.getByLabel('Key')
  await key.fill('tiles-preview')
  await key.press('Enter')
  await expect(page.getByRole('tab', { name: '* tiles.phaser-animations.json', exact: true })).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(page.getByLabel('Key')).toHaveValue('tiles-cycle')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByLabel('Key')).toHaveValue('tiles-preview')
  await page.getByTitle('Play').click()
  await expect(page.getByLabel('Animation frame')).toBeVisible()
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('tab', { name: 'tiles.phaser-animations.json', exact: true })).toBeVisible()

  await fs.mkdir(path.resolve('artifacts', 'screenshots', 'phase-3'), { recursive: true })
  await page.screenshot({ path: path.resolve('artifacts', 'screenshots', 'phase-3', 'atlas-animation-authoring-web.png') })
  expect(errors).toEqual([])
})

test('authors camera, physics, particle, and tween components and reopens them', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:4174/')
  await page.getByText('browser-demo', { exact: true }).dblclick()
  const projectPanel = page.getByRole('tabpanel', { name: 'Project' })
  await openProjectFolder(projectPanel, 'assets')
  await openProjectFolder(projectPanel, 'Scenes')
  await projectPanel.getByRole('option', { name: 'MainScene.phaser-scene.json', exact: true }).dblclick()
  await expect(page.getByTestId('scene-phaser-host').locator('canvas')).toBeVisible()

  await page.locator('.scene-object-row').filter({ hasText: 'World' }).click()
  await addComponent(page, 'phaser.camera')
  await page.getByLabel('Viewport W').fill('640')
  await page.getByLabel('Viewport W').press('Enter')

  await page.locator('.scene-object-row').filter({ hasText: 'Tiles Preview' }).click()
  await addComponent(page, 'phaser.arcade-body')
  await addComponent(page, 'phaser.matter-body')
  await addComponent(page, 'phaser.particle-emitter')
  await page.getByLabel('Texture').fill('assets/tiles.png')
  await page.getByLabel('Texture').press('Enter')
  await addComponent(page, 'phaser.tween')
  await page.getByLabel('To').fill('180')
  await page.getByLabel('To').press('Enter')
  await expect(page.getByLabel('Tween timeline')).toBeVisible()
  await page.keyboard.press('Control+s')

  const tab = page.locator('.flexlayout__tab_button').filter({ hasText: 'MainScene.phaser-scene.json' })
  await tab.locator('.flexlayout__tab_button_trailing').click()
  await openProjectFolder(projectPanel, 'Scenes')
  await projectPanel.getByRole('option', { name: 'MainScene.phaser-scene.json', exact: true }).dblclick()
  await page.locator('.scene-object-row').filter({ hasText: 'Tiles Preview' }).click()
  await expect(page.locator('.scene-component-header')).toContainText(['Arcade Body', 'Matter Body', 'Particle Emitter', 'Tween'])

  await fs.mkdir(path.resolve('artifacts', 'screenshots', 'phase-3'), { recursive: true })
  await page.screenshot({ path: path.resolve('artifacts', 'screenshots', 'phase-3', 'gameplay-components-web.png') })
  expect(errors).toEqual([])
})

async function openProjectFolder(projectPanel: Locator, name: string): Promise<void> {
  const row = projectPanel.getByRole('treeitem', { name: new RegExp(name, 'i') }).first()
  await expect(row).toBeVisible()
  if (await row.getAttribute('aria-expanded') !== 'true') await row.locator('.tree-chevron').click()
  await row.click()
}

async function addComponent(page: import('@playwright/test').Page, type: string): Promise<void> {
  await page.getByLabel('Component type').selectOption(type)
  await page.getByTitle('Add component').click()
}
