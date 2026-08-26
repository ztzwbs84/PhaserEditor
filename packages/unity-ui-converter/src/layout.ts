import type {
  RectTransformData,
  UIControlComponent,
  UIImageComponent,
  UINode,
  UIResource,
  UITextComponent,
  UnityUIDocument,
  Vec2
} from './schema.js'

export interface ResolvedRect {
  x: number
  y: number
  width: number
  height: number
  pivotX: number
  pivotY: number
}

export interface LayoutElementSize {
  minWidth: number
  preferredWidth: number
  flexibleWidth: number
  minHeight: number
  preferredHeight: number
  flexibleHeight: number
}

export interface UnityUITextMeasurement {
  width: number
  height: number
}

export interface ResolveUILayoutOptions {
  measureText?: (component: UITextComponent, maxWidth: number | null, node: UINode) => UnityUITextMeasurement
  maxPasses?: number
  epsilon?: number
}

export interface ResolvedUILayout {
  rects: Map<string, ResolvedRect>
  inputs: Map<string, LayoutElementSize>
}

interface LayoutState extends ResolvedRect {
  node: UINode
}

interface AxisSizes {
  min: number
  preferred: number
  flexible: number
}

interface AxisCandidate extends AxisSizes {
  priority: number
}

type LayoutGroupComponent = UIControlComponent & {
  type: 'horizontal-layout-group' | 'vertical-layout-group' | 'grid-layout-group'
}

export function deriveOffsets(rect: Pick<RectTransformData, 'anchorMin' | 'anchorMax' | 'pivot' | 'anchoredPosition' | 'sizeDelta'>): RectTransformData['offsets'] {
  return {
    left: rect.anchoredPosition.x - rect.pivot.x * rect.sizeDelta.x,
    right: -rect.anchoredPosition.x - (1 - rect.pivot.x) * rect.sizeDelta.x,
    bottom: rect.anchoredPosition.y - rect.pivot.y * rect.sizeDelta.y,
    top: -rect.anchoredPosition.y - (1 - rect.pivot.y) * rect.sizeDelta.y
  }
}

export function resolveRectTransform(rect: RectTransformData, parentSize: Vec2): ResolvedRect {
  const width = parentSize.x * (rect.anchorMax.x - rect.anchorMin.x) + rect.sizeDelta.x
  const height = parentSize.y * (rect.anchorMax.y - rect.anchorMin.y) + rect.sizeDelta.y
  const x = parentSize.x * rect.anchorMin.x + rect.offsets.left
  const bottom = parentSize.y * rect.anchorMin.y + rect.offsets.bottom
  const y = parentSize.y - bottom - height
  return {
    x,
    y,
    width,
    height,
    pivotX: x + width * rect.pivot.x,
    pivotY: y + height * (1 - rect.pivot.y)
  }
}

export function rectTransformCss(rect: RectTransformData): Record<string, string> {
  const widthPercent = (rect.anchorMax.x - rect.anchorMin.x) * 100
  const heightPercent = (rect.anchorMax.y - rect.anchorMin.y) * 100
  return {
    left: `calc(${formatPercent(rect.anchorMin.x)} ${formatPixelTerm(rect.offsets.left)})`,
    top: `calc(${formatPercent(1 - rect.anchorMax.y)} ${formatPixelTerm(rect.offsets.top)})`,
    width: `calc(${formatNumber(widthPercent)}% ${formatPixelTerm(rect.sizeDelta.x)})`,
    height: `calc(${formatNumber(heightPercent)}% ${formatPixelTerm(rect.sizeDelta.y)})`,
    transformOrigin: `${formatNumber(rect.pivot.x * 100)}% ${formatNumber((1 - rect.pivot.y) * 100)}%`
  }
}

export function resolveUILayout(
  document: UnityUIDocument,
  rootSize: Vec2 = document.canvas.referenceResolution,
  options: ResolveUILayoutOptions = {}
): ResolvedUILayout {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const children = new Map<string | null, UINode[]>()
  for (const node of document.nodes) {
    const entries = children.get(node.parentId) ?? []
    entries.push(node)
    children.set(node.parentId, entries)
  }
  for (const entries of children.values()) entries.sort((a, b) => a.order - b.order)

  const maxPasses = Math.max(1, options.maxPasses ?? 4)
  const epsilon = Math.max(0, options.epsilon ?? 0.01)
  const states = new Map<string, LayoutState>()
  for (const rootId of document.rootIds) {
    const root = nodesById.get(rootId)
    if (root) resolveBaseTree(root, null, rootSize, states, children)
  }
  for (const node of document.nodes) {
    if (!states.has(node.id)) resolveBaseTree(node, null, rootSize, states, children)
  }
  let previousRects: Map<string, ResolvedRect> | null = null
  let result: ResolvedUILayout = { rects: new Map(), inputs: new Map() }

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const inputs = new Map<string, LayoutElementSize>()
    const groupInputs = new Map<string, LayoutElementSize>()
    for (const rootId of document.rootIds) calculateLayoutInput(rootId, 0, document, states, inputs, groupInputs, children, options)
    for (const rootId of document.rootIds) applyLayoutAxis(rootId, 0, document, states, inputs, groupInputs, children)
    const horizontalInputs = new Map(inputs)
    inputs.clear()
    groupInputs.clear()
    for (const rootId of document.rootIds) calculateLayoutInput(rootId, 1, document, states, inputs, groupInputs, children, options)
    for (const rootId of document.rootIds) applyLayoutAxis(rootId, 1, document, states, inputs, groupInputs, children)

    const rects = new Map<string, ResolvedRect>()
    for (const [nodeId, state] of states) rects.set(nodeId, snapshotRect(state))
    const combinedInputs = new Map(horizontalInputs)
    for (const [nodeId, input] of inputs) combinedInputs.set(nodeId, mergeLayoutAxis(combinedInputs.get(nodeId), input, 1))
    result = { rects, inputs: combinedInputs }
    if (previousRects && layoutStable(previousRects, rects, epsilon)) break
    previousRects = rects
  }
  return result
}

function resolveBaseTree(
  node: UINode,
  parent: LayoutState | null,
  rootSize: Vec2,
  states: Map<string, LayoutState>,
  children: Map<string | null, UINode[]>
): void {
  const parentSize = parent ? { x: parent.width, y: parent.height } : rootSize
  const resolved = resolveRectTransform(node.rect, parentSize)
  const state: LayoutState = { ...resolved, node }
  applyParentAspect(state, parent ?? { width: rootSize.x, height: rootSize.y })
  states.set(node.id, state)
  for (const child of children.get(node.id) ?? []) resolveBaseTree(child, state, rootSize, states, children)
}

function calculateLayoutInput(
  nodeId: string,
  axis: 0 | 1,
  document: UnityUIDocument,
  states: Map<string, LayoutState>,
  inputs: Map<string, LayoutElementSize>,
  groupInputs: Map<string, LayoutElementSize>,
  children: Map<string | null, UINode[]>,
  options: ResolveUILayoutOptions
): LayoutElementSize {
  const state = states.get(nodeId)
  if (!state) return emptyLayoutSize()
  for (const child of children.get(nodeId) ?? []) calculateLayoutInput(child.id, axis, document, states, inputs, groupInputs, children, options)

  const serializedSize = axis === 0 ? state.width : state.height
  const candidates: AxisCandidate[] = [{ min: 0, preferred: Math.max(0, serializedSize), flexible: -1, priority: -1 }]
  const group = findLayoutGroup(state.node)
  if (group?.enabled) {
    const groupSize = calculateGroupSize(state, group, axis, states, inputs, children)
    const full = axis === 0
      ? { ...emptyLayoutSize(), minWidth: groupSize.min, preferredWidth: groupSize.preferred, flexibleWidth: groupSize.flexible }
      : { ...emptyLayoutSize(), minHeight: groupSize.min, preferredHeight: groupSize.preferred, flexibleHeight: groupSize.flexible }
    groupInputs.set(nodeId, mergeLayoutAxis(groupInputs.get(nodeId), full, axis))
    candidates.push({ ...groupSize, priority: 0 })
  }

  const text = state.node.components.find((component): component is UITextComponent => component.type === 'text' || component.type === 'text-mesh-pro')
  if (text?.enabled) {
    const maxWidth = axis === 1 && textOverflowMode(text, 'horizontal') === 'wrap' ? Math.max(0, state.width) : null
    const measured = options.measureText?.(text, maxWidth, state.node) ?? fallbackTextMeasurement(text, state, maxWidth)
    candidates.push({ min: 0, preferred: axis === 0 ? measured.width : measured.height, flexible: -1, priority: 0 })
  }

  const image = state.node.components.find((component): component is UIImageComponent => component.type === 'image' || component.type === 'raw-image')
  if (image?.enabled) {
    const preferred = preferredImageSize(image, document.resources, document.canvas.referencePixelsPerUnit, axis)
    candidates.push({ min: 0, preferred, flexible: -1, priority: 0 })
  }

  for (const element of state.node.components.filter((component): component is UIControlComponent => component.type === 'layout-element' && component.enabled)) {
    const properties = element.properties
    candidates.push({
      min: numberProperty(properties[axis === 0 ? 'm_MinWidth' : 'm_MinHeight'], -1),
      preferred: numberProperty(properties[axis === 0 ? 'm_PreferredWidth' : 'm_PreferredHeight'], -1),
      flexible: numberProperty(properties[axis === 0 ? 'm_FlexibleWidth' : 'm_FlexibleHeight'], -1),
      priority: numberProperty(properties.m_LayoutPriority, 1)
    })
  }

  const selected = selectLayoutProperties(candidates)
  const current = inputs.get(nodeId) ?? emptyLayoutSize()
  const next = axis === 0
    ? { ...current, minWidth: selected.min, preferredWidth: selected.preferred, flexibleWidth: selected.flexible }
    : { ...current, minHeight: selected.min, preferredHeight: selected.preferred, flexibleHeight: selected.flexible }
  inputs.set(nodeId, next)
  return next
}

function calculateGroupSize(
  state: LayoutState,
  group: LayoutGroupComponent,
  axis: 0 | 1,
  states: Map<string, LayoutState>,
  inputs: Map<string, LayoutElementSize>,
  children: Map<string | null, UINode[]>
): AxisSizes {
  const layoutChildren = eligibleLayoutChildren(state.node.id, states, children)
  const padding = readPadding(group.properties.m_Padding)
  const paddingSize = axis === 0 ? padding.left + padding.right : padding.top + padding.bottom
  if (group.type === 'grid-layout-group') {
    const cell = readVec2Property(group.properties.m_CellSize, { x: 100, y: 100 })
    const spacing = readVec2Property(group.properties.m_Spacing)
    const constraint = numberProperty(group.properties.m_Constraint)
    const constraintCount = Math.max(1, Math.floor(numberProperty(group.properties.m_ConstraintCount, 2)))
    if (axis === 0) {
      const columns = constraint === 1
        ? constraintCount
        : constraint === 2
          ? Math.ceil(layoutChildren.length / constraintCount - 0.001)
          : Math.max(1, Math.ceil(Math.sqrt(layoutChildren.length)))
      const minColumns = constraint === 0 ? Math.min(1, columns) : columns
      return {
        min: paddingSize + (cell.x + spacing.x) * minColumns - spacing.x,
        preferred: paddingSize + (cell.x + spacing.x) * columns - spacing.x,
        flexible: -1
      }
    }
    const columns = constraint === 1
      ? constraintCount
      : constraint === 2
        ? Math.max(1, Math.ceil(layoutChildren.length / constraintCount))
        : Math.max(1, Math.floor((state.width - padding.left - padding.right + spacing.x + 0.001) / Math.max(0.0001, cell.x + spacing.x)))
    const rows = constraint === 2 ? constraintCount : Math.ceil(layoutChildren.length / columns)
    const size = paddingSize + (cell.y + spacing.y) * rows - spacing.y
    return { min: size, preferred: size, flexible: -1 }
  }

  const vertical = group.type === 'vertical-layout-group'
  const alongOtherAxis = vertical !== (axis === 1)
  const spacing = numberProperty(group.properties.m_Spacing)
  const controlSize = booleanProperty(group.properties[axis === 0 ? 'm_ChildControlWidth' : 'm_ChildControlHeight'], true)
  const forceExpand = booleanProperty(group.properties[axis === 0 ? 'm_ChildForceExpandWidth' : 'm_ChildForceExpandHeight'], true)
  const useScale = booleanProperty(group.properties[axis === 0 ? 'm_ChildScaleWidth' : 'm_ChildScaleHeight'], false)
  let min = paddingSize
  let preferred = paddingSize
  let flexible = 0
  for (const child of layoutChildren) {
    const sizes = childSizes(child, axis, controlSize, forceExpand, states, inputs)
    const scale = useScale ? axisScale(child.rect, axis) : 1
    const scaled = { min: sizes.min * scale, preferred: sizes.preferred * scale, flexible: sizes.flexible * scale }
    if (alongOtherAxis) {
      min = Math.max(min, scaled.min + paddingSize)
      preferred = Math.max(preferred, scaled.preferred + paddingSize)
      flexible = Math.max(flexible, scaled.flexible)
    } else {
      min += scaled.min + spacing
      preferred += scaled.preferred + spacing
      flexible += scaled.flexible
    }
  }
  if (!alongOtherAxis && layoutChildren.length > 0) {
    min -= spacing
    preferred -= spacing
  }
  return { min, preferred: Math.max(min, preferred), flexible }
}

function applyLayoutAxis(
  nodeId: string,
  axis: 0 | 1,
  document: UnityUIDocument,
  states: Map<string, LayoutState>,
  inputs: Map<string, LayoutElementSize>,
  groupInputs: Map<string, LayoutElementSize>,
  children: Map<string | null, UINode[]>
): void {
  const state = states.get(nodeId)
  if (!state) return
  const parent = state.node.parentId ? states.get(state.node.parentId) ?? null : null
  applyAxisAspect(state, parent, axis)
  const fitter = findControl(state.node, 'content-size-fitter')
  if (fitter?.enabled) {
    const fit = numberProperty(fitter.properties[axis === 0 ? 'm_HorizontalFit' : 'm_VerticalFit'])
    const input = inputs.get(nodeId) ?? emptyLayoutSize()
    if (fit === 1) resizeState(state, axis, axis === 0 ? input.minWidth : input.minHeight)
    if (fit === 2) resizeState(state, axis, axis === 0 ? input.preferredWidth : input.preferredHeight)
  }
  rebaseChildrenAxis(state, axis, states, children)

  const group = findLayoutGroup(state.node)
  if (group?.enabled) {
    if (group.type === 'grid-layout-group') applyGridLayout(state, group, axis, states, children)
    else applyLinearLayout(state, group, axis, states, inputs, groupInputs, children)
  }
  for (const child of children.get(nodeId) ?? []) applyLayoutAxis(child.id, axis, document, states, inputs, groupInputs, children)
}

function applyLinearLayout(
  state: LayoutState,
  group: LayoutGroupComponent,
  axis: 0 | 1,
  states: Map<string, LayoutState>,
  inputs: Map<string, LayoutElementSize>,
  groupInputs: Map<string, LayoutElementSize>,
  children: Map<string | null, UINode[]>
): void {
  const layoutChildren = eligibleLayoutChildren(state.node.id, states, children)
  const ordered = booleanProperty(group.properties.m_ReverseArrangement, false) ? [...layoutChildren].reverse() : layoutChildren
  const vertical = group.type === 'vertical-layout-group'
  const alongOtherAxis = vertical !== (axis === 1)
  const size = axis === 0 ? state.width : state.height
  const padding = readPadding(group.properties.m_Padding)
  const startPadding = axis === 0 ? padding.left : padding.top
  const endPadding = axis === 0 ? padding.right : padding.bottom
  const spacing = numberProperty(group.properties.m_Spacing)
  const alignment = alignmentOnAxis(numberProperty(group.properties.m_ChildAlignment), axis)
  const controlSize = booleanProperty(group.properties[axis === 0 ? 'm_ChildControlWidth' : 'm_ChildControlHeight'], true)
  const forceExpand = booleanProperty(group.properties[axis === 0 ? 'm_ChildForceExpandWidth' : 'm_ChildForceExpandHeight'], true)
  const useScale = booleanProperty(group.properties[axis === 0 ? 'm_ChildScaleWidth' : 'm_ChildScaleHeight'], false)

  if (alongOtherAxis) {
    const innerSize = size - startPadding - endPadding
    for (const child of ordered) {
      const sizes = childSizes(child, axis, controlSize, forceExpand, states, inputs)
      const scale = useScale ? axisScale(child.rect, axis) : 1
      const required = clamp(innerSize, sizes.min, sizes.flexible > 0 ? size : sizes.preferred)
      const start = getStartOffset(size, startPadding, endPadding, required * scale, alignment)
      if (controlSize) setChildAxis(child, axis, start, required, scale, states, children)
      else {
        const currentSize = stateSize(states.get(child.id), axis)
        setChildAxis(child, axis, start + (required - currentSize) * alignment, currentSize, scale, states, children)
      }
    }
    return
  }

  const groupInput = groupInputs.get(state.node.id) ?? emptyLayoutSize()
  const totalMin = axis === 0 ? groupInput.minWidth : groupInput.minHeight
  const totalPreferred = axis === 0 ? groupInput.preferredWidth : groupInput.preferredHeight
  const totalFlexible = axis === 0 ? groupInput.flexibleWidth : groupInput.flexibleHeight
  let position = startPadding
  let flexibleMultiplier = 0
  const surplus = size - totalPreferred
  if (surplus > 0) {
    if (totalFlexible === 0) position = getStartOffset(size, startPadding, endPadding, totalPreferred - startPadding - endPadding, alignment)
    else if (totalFlexible > 0) flexibleMultiplier = surplus / totalFlexible
  }
  const minMaxLerp = totalMin === totalPreferred ? 0 : clamp01((size - totalMin) / (totalPreferred - totalMin))
  for (const child of ordered) {
    const sizes = childSizes(child, axis, controlSize, forceExpand, states, inputs)
    const scale = useScale ? axisScale(child.rect, axis) : 1
    const childSize = lerp(sizes.min, sizes.preferred, minMaxLerp) + sizes.flexible * flexibleMultiplier
    if (controlSize) setChildAxis(child, axis, position, childSize, scale, states, children)
    else {
      const currentSize = stateSize(states.get(child.id), axis)
      setChildAxis(child, axis, position + (childSize - currentSize) * alignment, currentSize, scale, states, children)
    }
    position += childSize * scale + spacing
  }
}

function applyGridLayout(
  state: LayoutState,
  group: LayoutGroupComponent,
  axis: 0 | 1,
  states: Map<string, LayoutState>,
  children: Map<string | null, UINode[]>
): void {
  const layoutChildren = eligibleLayoutChildren(state.node.id, states, children)
  const cell = readVec2Property(group.properties.m_CellSize, { x: 100, y: 100 })
  if (axis === 0) {
    for (const child of layoutChildren) {
      setChildAxis(child, 0, statePosition(states.get(child.id), 0), cell.x, 1, states, children)
      setChildAxis(child, 1, statePosition(states.get(child.id), 1), cell.y, 1, states, children)
    }
    return
  }
  const padding = readPadding(group.properties.m_Padding)
  const spacing = readVec2Property(group.properties.m_Spacing)
  const constraint = numberProperty(group.properties.m_Constraint)
  const constraintCount = Math.max(1, Math.floor(numberProperty(group.properties.m_ConstraintCount, 2)))
  let columns = 1
  let rows = 1
  if (constraint === 1) {
    columns = constraintCount
    rows = Math.max(1, Math.ceil(layoutChildren.length / columns))
  } else if (constraint === 2) {
    rows = constraintCount
    columns = Math.max(1, Math.ceil(layoutChildren.length / rows))
  } else {
    columns = cell.x + spacing.x <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.floor((state.width - padding.left - padding.right + spacing.x + 0.001) / (cell.x + spacing.x)))
    rows = cell.y + spacing.y <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.floor((state.height - padding.top - padding.bottom + spacing.y + 0.001) / (cell.y + spacing.y)))
  }
  const startAxis = numberProperty(group.properties.m_StartAxis)
  const actualColumns = Math.max(1, Math.min(columns, startAxis === 0 ? layoutChildren.length : Math.ceil(layoutChildren.length / rows)))
  const actualRows = Math.max(1, Math.min(rows, startAxis === 0 ? Math.ceil(layoutChildren.length / columns) : layoutChildren.length))
  const requiredWidth = actualColumns * cell.x + (actualColumns - 1) * spacing.x
  const requiredHeight = actualRows * cell.y + (actualRows - 1) * spacing.y
  const alignment = numberProperty(group.properties.m_ChildAlignment)
  const startX = getStartOffset(state.width, padding.left, padding.right, requiredWidth, alignmentOnAxis(alignment, 0))
  const startY = getStartOffset(state.height, padding.top, padding.bottom, requiredHeight, alignmentOnAxis(alignment, 1))
  const corner = numberProperty(group.properties.m_StartCorner)
  const cornerX = corner % 2
  const cornerY = Math.floor(corner / 2)
  const cellsPerMainAxis = startAxis === 0 ? columns : rows
  layoutChildren.forEach((child, index) => {
    let x = startAxis === 0 ? index % cellsPerMainAxis : Math.floor(index / cellsPerMainAxis)
    let y = startAxis === 0 ? Math.floor(index / cellsPerMainAxis) : index % cellsPerMainAxis
    if (cornerX === 1) x = actualColumns - 1 - x
    if (cornerY === 1) y = actualRows - 1 - y
    setChildAxis(child, 0, startX + (cell.x + spacing.x) * x, cell.x, 1, states, children)
    setChildAxis(child, 1, startY + (cell.y + spacing.y) * y, cell.y, 1, states, children)
  })
}

function setChildAxis(
  node: UINode,
  axis: 0 | 1,
  position: number,
  size: number,
  scale: number,
  states: Map<string, LayoutState>,
  children: Map<string | null, UINode[]>
): void {
  const state = states.get(node.id)
  if (!state) return
  const pivot = axis === 0 ? node.rect.pivot.x : 1 - node.rect.pivot.y
  const unscaledPosition = position + pivot * size * (scale - 1)
  if (axis === 0) {
    state.x = unscaledPosition
    state.width = Math.max(0, size)
  } else {
    state.y = unscaledPosition
    state.height = Math.max(0, size)
  }
  refreshPivot(state)
  rebaseChildrenAxis(state, axis, states, children)
}

function rebaseChildrenAxis(parent: LayoutState, axis: 0 | 1, states: Map<string, LayoutState>, children: Map<string | null, UINode[]>): void {
  for (const child of children.get(parent.node.id) ?? []) {
    const state = states.get(child.id)
    if (!state) continue
    const resolved = resolveRectTransform(child.rect, { x: parent.width, y: parent.height })
    if (axis === 0) {
      state.x = resolved.x
      state.width = Math.max(0, resolved.width)
    } else {
      state.y = resolved.y
      state.height = Math.max(0, resolved.height)
    }
    refreshPivot(state)
  }
}

function applyParentAspect(state: LayoutState, parent: Pick<LayoutState, 'width' | 'height'> | null): void {
  const aspect = findControl(state.node, 'aspect-ratio-fitter')
  if (!aspect?.enabled) return
  const mode = numberProperty(aspect.properties.m_AspectMode)
  const ratio = Math.max(0.001, numberProperty(aspect.properties.m_AspectRatio, 1))
  if (mode === 2) resizeState(state, 0, state.height * ratio)
  if (!parent || (mode !== 3 && mode !== 4)) return
  const parentRatio = parent.width / Math.max(0.001, parent.height)
  const fitWidth = (parentRatio > ratio) !== (mode === 4)
  const width = fitWidth ? parent.height * ratio : parent.width
  const height = fitWidth ? parent.height : parent.width / ratio
  state.width = width
  state.height = height
  state.x = (parent.width - width) * state.node.rect.pivot.x
  state.y = (parent.height - height) * (1 - state.node.rect.pivot.y)
  refreshPivot(state)
}

function applyAxisAspect(state: LayoutState, parent: LayoutState | null, axis: 0 | 1): void {
  const aspect = findControl(state.node, 'aspect-ratio-fitter')
  if (!aspect?.enabled) return
  const mode = numberProperty(aspect.properties.m_AspectMode)
  const ratio = Math.max(0.001, numberProperty(aspect.properties.m_AspectRatio, 1))
  if (axis === 0 && mode === 2) resizeState(state, 0, state.height * ratio)
  if (axis === 1 && mode === 1) resizeState(state, 1, state.width / ratio)
  if (parent && (mode === 3 || mode === 4)) applyParentAspect(state, parent)
}

function resizeState(state: LayoutState, axis: 0 | 1, nextSize: number): void {
  const size = Math.max(0, nextSize)
  if (axis === 0) {
    const pivot = state.pivotX
    state.width = size
    state.x = pivot - size * state.node.rect.pivot.x
  } else {
    const pivot = state.pivotY
    state.height = size
    state.y = pivot - size * (1 - state.node.rect.pivot.y)
  }
  refreshPivot(state)
}

function childSizes(node: UINode, axis: 0 | 1, controlSize: boolean, forceExpand: boolean, states: Map<string, LayoutState>, inputs: Map<string, LayoutElementSize>): AxisSizes {
  if (!controlSize) {
    const size = stateSize(states.get(node.id), axis)
    return { min: size, preferred: size, flexible: forceExpand ? 1 : 0 }
  }
  const input = inputs.get(node.id) ?? emptyLayoutSize()
  const min = axis === 0 ? input.minWidth : input.minHeight
  const preferred = axis === 0 ? input.preferredWidth : input.preferredHeight
  let flexible = axis === 0 ? input.flexibleWidth : input.flexibleHeight
  if (forceExpand) flexible = Math.max(flexible, 1)
  return { min, preferred: Math.max(min, preferred), flexible: Math.max(0, flexible) }
}

function eligibleLayoutChildren(parentId: string, states: Map<string, LayoutState>, children: Map<string | null, UINode[]>): UINode[] {
  return (children.get(parentId) ?? []).filter((node) => node.active && !ignoreLayout(node) && states.has(node.id))
}

function ignoreLayout(node: UINode): boolean {
  const element = findControl(node, 'layout-element')
  return Boolean(element?.enabled && booleanProperty(element.properties.m_IgnoreLayout, false))
}

function findLayoutGroup(node: UINode): LayoutGroupComponent | undefined {
  return node.components.find((component): component is LayoutGroupComponent => component.type === 'horizontal-layout-group' || component.type === 'vertical-layout-group' || component.type === 'grid-layout-group')
}

function findControl<T extends UIControlComponent['type']>(node: UINode, type: T): Extract<UIControlComponent, { type: T }> | UIControlComponent | undefined {
  return node.components.find((component): component is UIControlComponent => component.type === type)
}

function preferredImageSize(component: UIImageComponent, resources: Record<string, UIResource>, referencePixelsPerUnit: number, axis: 0 | 1): number {
  const resource = component.resourceId ? resources[component.resourceId] : undefined
  const pixels = axis === 0
    ? resource?.sprite?.rect.width ?? resource?.width ?? 0
    : resource?.sprite?.rect.height ?? resource?.height ?? 0
  const spritePixelsPerUnit = resource?.sprite?.pixelsPerUnit ?? referencePixelsPerUnit
  return pixels * referencePixelsPerUnit / Math.max(0.0001, spritePixelsPerUnit)
}

function fallbackTextMeasurement(component: UITextComponent, state: LayoutState, maxWidth: number | null): UnityUITextMeasurement {
  const plain = component.text.replace(/<[^>]+>/g, '')
  const lines = plain.split(/\r?\n/)
  const averageWidth = Math.max(1, component.fontSize * 0.55 + component.characterSpacing)
  const naturalWidth = Math.max(0, ...lines.map((line) => line.length * averageWidth))
  const width = maxWidth == null ? naturalWidth : Math.min(naturalWidth, maxWidth)
  const wrappedLines = maxWidth && maxWidth > 0 ? lines.reduce((count, line) => count + Math.max(1, Math.ceil(line.length * averageWidth / maxWidth)), 0) : lines.length
  const lineHeight = component.type === 'text' ? component.fontSize * Math.max(0.1, component.lineSpacing) : component.fontSize + component.lineSpacing
  return { width: width || Math.max(0, state.width), height: Math.max(lineHeight, wrappedLines * lineHeight) }
}

function textOverflowMode(component: UITextComponent, axis: 'horizontal' | 'vertical'): 'wrap' | 'overflow' | 'truncate' {
  if (axis === 'horizontal') return component.horizontalOverflowMode ?? (component.wordWrap ? 'wrap' : 'overflow')
  return component.verticalOverflowMode ?? (component.verticalOverflow === 1 ? 'overflow' : 'truncate')
}

function selectLayoutProperties(candidates: AxisCandidate[]): AxisSizes {
  const min = selectLayoutProperty(candidates, 'min', 0)
  return {
    min,
    preferred: Math.max(min, selectLayoutProperty(candidates, 'preferred', 0)),
    flexible: selectLayoutProperty(candidates, 'flexible', 0)
  }
}

function selectLayoutProperty(candidates: AxisCandidate[], property: keyof AxisSizes, fallback: number): number {
  let priority = Number.NEGATIVE_INFINITY
  let selected = fallback
  for (const candidate of candidates) {
    const value = candidate[property]
    if (value < 0) continue
    if (candidate.priority > priority) {
      priority = candidate.priority
      selected = value
    } else if (candidate.priority === priority) selected = Math.max(selected, value)
  }
  return selected
}

function mergeLayoutAxis(current: LayoutElementSize | undefined, next: LayoutElementSize, axis: 0 | 1): LayoutElementSize {
  const result = current ?? emptyLayoutSize()
  return axis === 0
    ? { ...result, minWidth: next.minWidth, preferredWidth: next.preferredWidth, flexibleWidth: next.flexibleWidth }
    : { ...result, minHeight: next.minHeight, preferredHeight: next.preferredHeight, flexibleHeight: next.flexibleHeight }
}

function emptyLayoutSize(): LayoutElementSize {
  return {
    minWidth: 0,
    preferredWidth: 0,
    flexibleWidth: 0,
    minHeight: 0,
    preferredHeight: 0,
    flexibleHeight: 0
  }
}

function readPadding(value: unknown): { left: number; right: number; top: number; bottom: number } {
  const record = asRecord(value)
  return {
    left: numberProperty(record.m_Left ?? record.left),
    right: numberProperty(record.m_Right ?? record.right),
    top: numberProperty(record.m_Top ?? record.top),
    bottom: numberProperty(record.m_Bottom ?? record.bottom)
  }
}

function readVec2Property(value: unknown, fallback: Vec2 = { x: 0, y: 0 }): Vec2 {
  const record = asRecord(value)
  return {
    x: numberProperty(record.x, fallback.x),
    y: numberProperty(record.y, fallback.y)
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberProperty(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function booleanProperty(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 1 || value === '1') return true
  if (value === false || value === 0 || value === '0') return false
  return fallback
}

function axisScale(rect: RectTransformData, axis: 0 | 1): number {
  return Math.abs(axis === 0 ? rect.localScale.x : rect.localScale.y)
}

function alignmentOnAxis(alignment: number, axis: 0 | 1): number {
  const normalized = clamp(Math.floor(alignment), 0, 8)
  return axis === 0 ? normalized % 3 / 2 : Math.floor(normalized / 3) / 2
}

function getStartOffset(totalSize: number, startPadding: number, endPadding: number, requiredSize: number, alignment: number): number {
  return startPadding + (totalSize - startPadding - endPadding - requiredSize) * clamp01(alignment)
}

function clamp(value: number, min: number, max: number): number {
  const normalizedMax = Math.max(min, max)
  return Math.min(normalizedMax, Math.max(min, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * clamp01(amount)
}

function stateSize(state: LayoutState | undefined, axis: 0 | 1): number {
  if (!state) return 0
  return axis === 0 ? state.width : state.height
}

function statePosition(state: LayoutState | undefined, axis: 0 | 1): number {
  if (!state) return 0
  return axis === 0 ? state.x : state.y
}

function refreshPivot(state: LayoutState): void {
  state.pivotX = state.x + state.width * state.node.rect.pivot.x
  state.pivotY = state.y + state.height * (1 - state.node.rect.pivot.y)
}

function snapshotRect(state: LayoutState): ResolvedRect {
  return {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    pivotX: state.pivotX,
    pivotY: state.pivotY
  }
}

function layoutStable(previous: Map<string, ResolvedRect>, next: Map<string, ResolvedRect>, epsilon: number): boolean {
  if (previous.size !== next.size) return false
  for (const [nodeId, rect] of next) {
    const before = previous.get(nodeId)
    if (!before) return false
    if (
      Math.abs(before.x - rect.x) > epsilon ||
      Math.abs(before.y - rect.y) > epsilon ||
      Math.abs(before.width - rect.width) > epsilon ||
      Math.abs(before.height - rect.height) > epsilon
    ) return false
  }
  return true
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`
}

function formatPixelTerm(value: number): string {
  const sign = value < 0 ? '-' : '+'
  return `${sign} ${formatNumber(Math.abs(value))}px`
}

function formatNumber(value: number): string {
  return Number(value.toFixed(5)).toString()
}
