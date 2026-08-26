import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertUnityPrefab, layoutUnityText, UnityAssetIndex } from '../packages/unity-ui-converter/src/index.js'
import type { UITextComponent } from '../packages/unity-ui-converter/src/schema.js'

describe('Unity text layout', () => {
  it('keeps rich text sizes and overflow bounds outside the logical rect', () => {
    const component = textComponent('A<size=90>B</size>', { fontSize: 75, horizontalOverflowMode: 'overflow', verticalOverflowMode: 'overflow' })
    const layout = layoutUnityText(mockCanvasContext(), component, { fontFamily: 'sans-serif', width: 100, height: 50 })
    expect(layout.glyphs.some((glyph) => glyph.font.includes('90px'))).toBe(true)
    expect(layout.clipped).toBe(false)
    expect(layout.bounds.y).toBeLessThan(0)
    expect(layout.bounds.height).toBeGreaterThan(50)
  })

  it('clips only truncate mode and applies best fit through the shared measurer', () => {
    const truncated = layoutUnityText(mockCanvasContext(), textComponent('ABCDEFGHIJ', { verticalOverflowMode: 'truncate' }), { fontFamily: 'sans-serif', width: 50, height: 20 })
    expect(truncated).toMatchObject({ clipped: true, bounds: { x: 0, y: 0, width: 50, height: 20 } })

    const fitted = layoutUnityText(mockCanvasContext(), textComponent('1234567890', {
      fontSize: 40,
      bestFit: true,
      minSize: 8,
      maxSize: 40,
      horizontalOverflowMode: 'overflow',
      verticalOverflowMode: 'overflow'
    }), { fontFamily: 'sans-serif', width: 50, height: 20 })
    expect(fitted.fontSize).toBe(10)
  })
})

describe('nested Prefab aliases', () => {
  it('applies a third-level stripped RectTransform override and attaches components added to a stripped GameObject', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'unity-ui-nested-'))
    const assets = path.join(root, 'Assets')
    await mkdir(assets, { recursive: true })
    const guidA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const guidB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const guidC = 'cccccccccccccccccccccccccccccccc'
    const prefabA = path.join(assets, 'A.prefab')
    const prefabB = path.join(assets, 'B.prefab')
    const prefabC = path.join(assets, 'C.prefab')
    try {
      await Promise.all([
        writePrefab(prefabA, guidA, outerPrefab(guidB)),
        writePrefab(prefabB, guidB, middlePrefab(guidC)),
        writePrefab(prefabC, guidC, leafPrefab())
      ])
      const index = await UnityAssetIndex.build(assets)
      const document = await convertUnityPrefab(prefabA, index)
      const deep = document.nodes.find((node) => node.name === 'Deep')
      expect(deep?.rect.anchoredPosition.x).toBe(42)
      expect(deep?.rect.sizeDelta.x).toBe(90)
      expect(deep?.sourceReferences).toEqual(expect.arrayContaining([
        expect.objectContaining({ guid: guidC, fileId: '200' }),
        expect.objectContaining({ guid: guidB, fileId: '5000' })
      ]))
      expect(deep?.components).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'layout-element', properties: expect.objectContaining({ m_PreferredWidth: 45 }) })
      ]))
      expect(document.diagnostics.filter((diagnostic) => diagnostic.code === 'PREFAB_OVERRIDE_UNSUPPORTED')).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function textComponent(text: string, overrides: Partial<UITextComponent> = {}): UITextComponent {
  return {
    id: 'text',
    sourceFileId: 'text',
    type: 'text',
    enabled: true,
    resourceId: null,
    text,
    color: { r: 1, g: 1, b: 1, a: 1 },
    fontSize: 20,
    fontStyle: 0,
    alignment: 4,
    horizontalAlignment: 'center',
    verticalAlignment: 'middle',
    alignByGeometry: false,
    lineSpacing: 1,
    characterSpacing: 0,
    richText: true,
    bestFit: false,
    minSize: 8,
    maxSize: 40,
    horizontalOverflow: 1,
    verticalOverflow: 1,
    horizontalOverflowMode: 'overflow',
    verticalOverflowMode: 'overflow',
    wordWrap: false,
    raycastTarget: false,
    effects: [],
    ...overrides
  }
}

function mockCanvasContext(): CanvasRenderingContext2D {
  const context = {
    font: '10px sans-serif',
    measureText(value: string) {
      const size = Number(context.font.match(/([\d.]+)px/u)?.[1] ?? 10)
      return { width: Array.from(value).length * size * 0.5, actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2 } as TextMetrics
    }
  }
  return context as unknown as CanvasRenderingContext2D
}

async function writePrefab(filePath: string, guid: string, source: string): Promise<void> {
  await Promise.all([
    writeFile(filePath, source, 'utf8'),
    writeFile(`${filePath}.meta`, `fileFormatVersion: 2\nguid: ${guid}\nPrefabImporter:\n  externalObjects: {}\n`, 'utf8')
  ])
}

function leafPrefab(): string {
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Component:
  - component: {fileID: 200}
  m_Layer: 5
  m_Name: Deep
  m_IsActive: 1
--- !u!224 &200
RectTransform:
  m_GameObject: {fileID: 100}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_AnchorMin: {x: 0.5, y: 0.5}
  m_AnchorMax: {x: 0.5, y: 0.5}
  m_AnchoredPosition: {x: 0, y: 0}
  m_SizeDelta: {x: 20, y: 20}
  m_Pivot: {x: 0.5, y: 0.5}
`
}

function middlePrefab(leafGuid: string): string {
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &1000
GameObject:
  m_Component:
  - component: {fileID: 2000}
  m_Layer: 5
  m_Name: Middle
  m_IsActive: 1
--- !u!224 &2000
RectTransform:
  m_GameObject: {fileID: 1000}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_AnchorMin: {x: 0.5, y: 0.5}
  m_AnchorMax: {x: 0.5, y: 0.5}
  m_AnchoredPosition: {x: 0, y: 0}
  m_SizeDelta: {x: 200, y: 100}
  m_Pivot: {x: 0.5, y: 0.5}
--- !u!1001 &3000
PrefabInstance:
  serializedVersion: 2
  m_Modification:
    m_TransformParent: {fileID: 2000}
    m_Modifications:
    - target: {fileID: 200, guid: ${leafGuid}, type: 3}
      propertyPath: m_SizeDelta.x
      value: 60
      objectReference: {fileID: 0}
    m_RemovedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${leafGuid}, type: 3}
--- !u!1 &4000 stripped
GameObject:
  m_CorrespondingSourceObject: {fileID: 100, guid: ${leafGuid}, type: 3}
  m_PrefabInstance: {fileID: 3000}
  m_PrefabAsset: {fileID: 0}
--- !u!224 &5000 stripped
RectTransform:
  m_CorrespondingSourceObject: {fileID: 200, guid: ${leafGuid}, type: 3}
  m_PrefabInstance: {fileID: 3000}
  m_PrefabAsset: {fileID: 0}
--- !u!114 &6000
MonoBehaviour:
  m_GameObject: {fileID: 4000}
  m_Enabled: 1
  m_Script: {fileID: 11500000, guid: 306cc8c2b49d7114eaa3623786fc2126, type: 3}
  m_IgnoreLayout: 0
  m_MinWidth: -1
  m_MinHeight: -1
  m_PreferredWidth: 45
  m_PreferredHeight: -1
  m_FlexibleWidth: -1
  m_FlexibleHeight: -1
  m_LayoutPriority: 1
`
}

function outerPrefab(middleGuid: string): string {
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &10000
GameObject:
  m_Component:
  - component: {fileID: 20000}
  m_Layer: 5
  m_Name: Outer
  m_IsActive: 1
--- !u!224 &20000
RectTransform:
  m_GameObject: {fileID: 10000}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_AnchorMin: {x: 0.5, y: 0.5}
  m_AnchorMax: {x: 0.5, y: 0.5}
  m_AnchoredPosition: {x: 0, y: 0}
  m_SizeDelta: {x: 400, y: 300}
  m_Pivot: {x: 0.5, y: 0.5}
--- !u!1001 &30000
PrefabInstance:
  serializedVersion: 2
  m_Modification:
    m_TransformParent: {fileID: 20000}
    m_Modifications:
    - target: {fileID: 5000, guid: ${middleGuid}, type: 3}
      propertyPath: m_SizeDelta.x
      value: 90
      objectReference: {fileID: 0}
    - target: {fileID: 5000, guid: ${middleGuid}, type: 3}
      propertyPath: m_AnchoredPosition.x
      value: 42
      objectReference: {fileID: 0}
    m_RemovedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${middleGuid}, type: 3}
`
}
