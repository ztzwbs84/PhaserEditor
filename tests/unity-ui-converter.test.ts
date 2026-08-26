import { describe, expect, it } from 'vitest'
import { deriveOffsets, parseUnityYaml, rectTransformCss, resolveRectTransform, resolveUILayout, verticalTextPadding } from '../packages/unity-ui-converter/src/index.js'
import type { RectTransformData, UIControlComponent, UINode, UnityUIDocument } from '../packages/unity-ui-converter/src/schema.js'

describe('Unity UGUI converter', () => {
  it('preserves Unity file IDs larger than Number.MAX_SAFE_INTEGER', () => {
    const source = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &40994661599995459
GameObject:
  m_Name: BigId
  m_Component:
  - component: {fileID: 4500730913960628369}
--- !u!224 &4500730913960628369
RectTransform:
  m_GameObject: {fileID: 40994661599995459}
  m_Father: {fileID: 0}
`
    const diagnostics: [] = []
    const objects = parseUnityYaml(source, 'fixture.prefab', diagnostics)
    expect(diagnostics).toEqual([])
    expect(objects[0]?.fileId).toBe('40994661599995459')
    expect((objects[0]?.data.m_Component as Array<{ component: { fileID: string } }>)[0]?.component.fileID).toBe('4500730913960628369')
  })

  it('normalizes duplicated m_Sprite keys emitted by a Unity UI exporter', () => {
    const source = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &123
MonoBehaviour:
  m_Sprite: m_Sprite: {fileID: 21300000, guid: 5863dfe461dc1d0428b35fe4f68bee34, type: 3}
`
    const diagnostics: import('../packages/unity-ui-converter/src/schema.js').UIDiagnostic[] = []
    const objects = parseUnityYaml(source, 'fixture.prefab', diagnostics)
    expect(objects).toHaveLength(1)
    expect((objects[0]?.data.m_Sprite as { fileID: string }).fileID).toBe('21300000')
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'UNITY_YAML_NORMALIZED' })
    ])
  })

  it('resolves fixed and stretched RectTransforms with Unity pivot math', () => {
    const rect: RectTransformData = {
      anchorMin: { x: 0.25, y: 0.1 },
      anchorMax: { x: 0.75, y: 0.9 },
      pivot: { x: 0.25, y: 0.75 },
      anchoredPosition: { x: 12, y: -8 },
      sizeDelta: { x: -40, y: 20 },
      localPosition: { x: 0, y: 0, z: 0 },
      localRotation: { x: 0, y: 0, z: 0, w: 1 },
      localEulerAngles: { x: 0, y: 0, z: 0 },
      localScale: { x: 1, y: 1, z: 1 },
      offsets: { left: 0, right: 0, top: 0, bottom: 0 }
    }
    rect.offsets = deriveOffsets(rect)
    expect(resolveRectTransform(rect, { x: 1000, y: 500 })).toEqual({
      x: 272,
      y: 53,
      width: 460,
      height: 420,
      pivotX: 387,
      pivotY: 158
    })
    expect(rectTransformCss(rect)).toMatchObject({
      left: 'calc(25% + 22px)',
      width: 'calc(50% - 40px)'
    })
  })

  it('positions Phaser text from its natural height before applying a fixed UI rect', () => {
    expect(verticalTextPadding(0, 60, 24)).toBe(0)
    expect(verticalTextPadding(1, 60, 24)).toBe(18)
    expect(verticalTextPadding(2, 60, 24)).toBe(36)
    expect(verticalTextPadding(1, 20, 24)).toBe(0)
  })

  it('resolves horizontal and vertical layout groups with LayoutElement, reverse order, and ignoreLayout', () => {
    const horizontal = node('horizontal', null, stretchRect(), [control('horizontal-layout-group', {
      m_Padding: { m_Left: 10, m_Right: 20, m_Top: 5, m_Bottom: 5 },
      m_Spacing: 10,
      m_ChildAlignment: 1,
      m_ChildControlWidth: 1,
      m_ChildControlHeight: 1,
      m_ChildForceExpandWidth: 0,
      m_ChildForceExpandHeight: 0,
      m_ReverseArrangement: 1
    })])
    const first = node('first', 'horizontal', fixedRect(20, 20), [layoutElement({ m_PreferredWidth: 50, m_PreferredHeight: 20 })], 0)
    const ignored = node('ignored', 'horizontal', fixedRect(30, 30, 4, 7), [layoutElement({ m_IgnoreLayout: 1 })], 1)
    const second = node('second', 'horizontal', fixedRect(20, 20), [layoutElement({ m_PreferredWidth: 80, m_PreferredHeight: 30 })], 2)
    const doc = documentFor([horizontal, first, ignored, second], { x: 300, y: 100 })

    const rects = resolveUILayout(doc).rects
    expect(rects.get('second')).toMatchObject({ x: 75, y: 5, width: 80, height: 30 })
    expect(rects.get('first')).toMatchObject({ x: 165, y: 5, width: 50, height: 20 })
    expect(rects.get('ignored')).toMatchObject({ x: 4, y: 7, width: 30, height: 30 })

    horizontal.components[0] = control('vertical-layout-group', {
      m_Padding: { m_Left: 5, m_Right: 5, m_Top: 10, m_Bottom: 20 },
      m_Spacing: 10,
      m_ChildAlignment: 3,
      m_ChildControlWidth: 1,
      m_ChildControlHeight: 1,
      m_ChildForceExpandWidth: 0,
      m_ChildForceExpandHeight: 0
    })
    const verticalRects = resolveUILayout(doc).rects
    expect(verticalRects.get('first')).toMatchObject({ x: 5, y: 15, width: 50, height: 20 })
    expect(verticalRects.get('second')).toMatchObject({ x: 5, y: 45, width: 80, height: 30 })
  })

  it('resolves grid constraints, corner, axis, and cell sizes', () => {
    const grid = node('grid', null, stretchRect(), [control('grid-layout-group', {
      m_Padding: { m_Left: 10, m_Right: 10, m_Top: 10, m_Bottom: 10 },
      m_CellSize: { x: 50, y: 40 },
      m_Spacing: { x: 5, y: 6 },
      m_StartCorner: 0,
      m_StartAxis: 0,
      m_ChildAlignment: 0,
      m_Constraint: 1,
      m_ConstraintCount: 2
    })])
    const children = [0, 1, 2].map((order) => node(`child-${order}`, 'grid', fixedRect(1, 1), [], order))
    const rects = resolveUILayout(documentFor([grid, ...children], { x: 220, y: 130 })).rects
    expect(rects.get('child-0')).toMatchObject({ x: 10, y: 10, width: 50, height: 40 })
    expect(rects.get('child-1')).toMatchObject({ x: 65, y: 10, width: 50, height: 40 })
    expect(rects.get('child-2')).toMatchObject({ x: 10, y: 56, width: 50, height: 40 })
  })

  it('resolves ContentSizeFitter and AspectRatioFitter across repeated layout passes', () => {
    const content = node('content', null, fixedRect(10, 40), [
      control('horizontal-layout-group', {
        m_Padding: { m_Left: 5, m_Right: 7, m_Top: 0, m_Bottom: 0 },
        m_Spacing: 3,
        m_ChildControlWidth: 1,
        m_ChildControlHeight: 0,
        m_ChildForceExpandWidth: 0,
        m_ChildForceExpandHeight: 0
      }),
      control('content-size-fitter', { m_HorizontalFit: 2, m_VerticalFit: 0 })
    ])
    const childA = node('a', 'content', fixedRect(1, 20), [layoutElement({ m_PreferredWidth: 20 })], 0)
    const childB = node('b', 'content', fixedRect(1, 20), [layoutElement({ m_PreferredWidth: 30 })], 1)
    const aspect = node('aspect', null, fixedRect(80, 10, 0, 50), [control('aspect-ratio-fitter', { m_AspectMode: 1, m_AspectRatio: 2 })], 1)
    const rects = resolveUILayout(documentFor([content, childA, childB, aspect], { x: 300, y: 200 })).rects
    expect(rects.get('content')?.width).toBe(65)
    expect(rects.get('a')).toMatchObject({ x: 5, width: 20 })
    expect(rects.get('b')).toMatchObject({ x: 28, width: 30 })
    expect(rects.get('aspect')).toMatchObject({ width: 80, height: 40 })
  })

  it('resolves every active AspectRatioFitter sizing mode', () => {
    const widthControlsHeight = node('width-controls-height', null, fixedRect(80, 10), [control('aspect-ratio-fitter', { m_AspectMode: 1, m_AspectRatio: 2 })])
    const heightControlsWidth = node('height-controls-width', null, fixedRect(10, 30), [control('aspect-ratio-fitter', { m_AspectMode: 2, m_AspectRatio: 2 })], 1)
    const fit = node('fit', null, stretchRect(), [control('aspect-ratio-fitter', { m_AspectMode: 3, m_AspectRatio: 2 })], 2)
    const envelope = node('envelope', null, stretchRect(), [control('aspect-ratio-fitter', { m_AspectMode: 4, m_AspectRatio: 2 })], 3)
    const rects = resolveUILayout(documentFor([widthControlsHeight, heightControlsWidth, fit, envelope], { x: 300, y: 100 })).rects
    expect(rects.get('width-controls-height')).toMatchObject({ width: 80, height: 40 })
    expect(rects.get('height-controls-width')).toMatchObject({ width: 60, height: 30 })
    expect(rects.get('fit')).toMatchObject({ x: 50, y: 0, width: 200, height: 100 })
    expect(rects.get('envelope')).toMatchObject({ x: 0, y: -25, width: 300, height: 150 })
  })
})

function documentFor(nodes: UINode[], size: { x: number; y: number }): UnityUIDocument {
  return {
    format: 'phaser-editor-unity-ugui',
    version: 1,
    name: 'fixture',
    source: { prefabPath: 'fixture.prefab', prefabGuid: null, unityVersion: null },
    canvas: { referenceResolution: size, scaleMode: 0, screenMatchMode: 0, matchWidthOrHeight: 0, referencePixelsPerUnit: 100, sortingOrder: 0 },
    rootIds: nodes.filter((entry) => entry.parentId === null).map((entry) => entry.id),
    nodes,
    resources: {},
    nestedPrefabs: [],
    diagnostics: [],
    statistics: { nodeCount: nodes.length, componentCounts: {}, resourceCount: 0, errorCount: 0, warningCount: 0 }
  }
}

function node(id: string, parentId: string | null, rect: RectTransformData, components: UIControlComponent[], order = 0): UINode {
  return { id, sourceFileId: id, rectSourceFileId: id, name: id, parentId, order, active: true, layer: 0, rect, components }
}

function control(type: UIControlComponent['type'], properties: Record<string, unknown>): UIControlComponent {
  return { id: `${type}-component`, sourceFileId: `${type}-source`, type, enabled: true, properties }
}

function layoutElement(properties: Record<string, unknown>): UIControlComponent {
  return control('layout-element', { m_IgnoreLayout: 0, m_MinWidth: -1, m_MinHeight: -1, m_PreferredWidth: -1, m_PreferredHeight: -1, m_FlexibleWidth: -1, m_FlexibleHeight: -1, m_LayoutPriority: 1, ...properties })
}

function stretchRect(): RectTransformData {
  const rect = fixedRect(0, 0)
  rect.anchorMin = { x: 0, y: 0 }
  rect.anchorMax = { x: 1, y: 1 }
  rect.pivot = { x: 0.5, y: 0.5 }
  rect.anchoredPosition = { x: 0, y: 0 }
  rect.sizeDelta = { x: 0, y: 0 }
  rect.offsets = deriveOffsets(rect)
  return rect
}

function fixedRect(width: number, height: number, left = 0, top = 0): RectTransformData {
  const rect: RectTransformData = {
    anchorMin: { x: 0, y: 1 },
    anchorMax: { x: 0, y: 1 },
    pivot: { x: 0, y: 1 },
    anchoredPosition: { x: left, y: -top },
    sizeDelta: { x: width, y: height },
    localPosition: { x: 0, y: 0, z: 0 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localEulerAngles: { x: 0, y: 0, z: 0 },
    localScale: { x: 1, y: 1, z: 1 },
    offsets: { left: 0, right: 0, top: 0, bottom: 0 }
  }
  rect.offsets = deriveOffsets(rect)
  return rect
}
