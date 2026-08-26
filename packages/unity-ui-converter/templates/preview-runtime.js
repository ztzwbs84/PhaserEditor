import { resolveUILayout } from './layout.js'
import { drawUnityText, layoutUnityText, measureUnityText } from './text-layout.js'

(() => {
  'use strict'

  const bundle = window.__UNITY_UI_PREVIEW__ || { documents: [] }
  const elements = {
    prefab: document.getElementById('prefabSelect'), width: document.getElementById('canvasWidth'), height: document.getElementById('canvasHeight'),
    scale: document.getElementById('scaleMode'), debug: document.getElementById('debugToggle'), reset: document.getElementById('resetButton'),
    viewport: document.getElementById('viewport'), stage: document.getElementById('stage'), hierarchy: document.getElementById('hierarchy'),
    inspector: document.getElementById('inspector'), diagnostics: document.getElementById('diagnostics'), diagnosticCount: document.getElementById('diagnosticCount'), status: document.getElementById('status')
  }
  const imageCache = new Map()
  let current = null
  let selectedNodeId = null
  let fontsReady = false
  let documentGeneration = 0

  bundle.documents.forEach((entry, index) => elements.prefab.add(new Option(entry.name, String(index))))
  elements.prefab.addEventListener('change', () => void showDocument(Number(elements.prefab.value)))
  elements.width.addEventListener('input', resizeStage)
  elements.height.addEventListener('input', resizeStage)
  elements.scale.addEventListener('change', resizeStage)
  elements.debug.addEventListener('change', () => elements.stage.classList.toggle('debug', elements.debug.checked))
  elements.reset.addEventListener('click', () => void showDocument(Number(elements.prefab.value)))
  window.addEventListener('resize', resizeStage)

  if (bundle.documents.length) void showDocument(0)
  else elements.status.textContent = 'No prefab data'

  async function showDocument(index) {
    const generation = ++documentGeneration
    current = structuredClone(bundle.documents[index])
    selectedNodeId = null
    fontsReady = false
    elements.width.value = current.canvas.referenceResolution.x
    elements.height.value = current.canvas.referenceResolution.y
    elements.stage.replaceChildren()
    elements.hierarchy.replaceChildren()
    await installFonts(current)
    if (generation !== documentGeneration) return
    fontsReady = true
    const children = groupByParent(current.nodes)
    renderHierarchy(children)
    renderDiagnostics(current.diagnostics)
    elements.status.textContent = `${current.statistics.nodeCount} nodes | ${current.statistics.resourceCount} resources`
    resizeStage()
  }

  function renderStage(width, height) {
    const context = document.createElement('canvas').getContext('2d')
    const layout = resolveUILayout(current, { x: width, y: height }, {
      measureText: context ? (component, maxWidth) => measureUnityText(context, component, maxWidth, textFontFamily(component)) : undefined
    })
    const children = groupByParent(current.nodes)
    elements.stage.replaceChildren()
    for (const rootId of current.rootIds) {
      const root = current.nodes.find((node) => node.id === rootId)
      if (root) elements.stage.append(createNode(root, children, layout.rects))
    }
    if (selectedNodeId) {
      elements.stage.querySelector(`[data-node-id="${CSS.escape(selectedNodeId)}"]`)?.classList.add('selected-node')
    }
  }

  function createNode(node, children, resolvedRects) {
    const resolved = resolvedRects.get(node.id)
    if (!resolved) return document.createComment(`Missing layout for ${node.name}`)
    const element = document.createElement('div')
    element.className = 'unity-node'
    element.dataset.nodeId = node.id
    element.dataset.nodeName = node.name
    element.style.zIndex = String(node.order)
    element.style.display = node.active ? 'block' : 'none'
    applyRectStyle(element, node.rect, resolved)
    const layer = document.createElement('div')
    layer.className = 'component-layer'
    element.append(layer)
    const label = document.createElement('span')
    label.className = 'debug-label'
    label.textContent = `${node.name} [${node.order}]`
    element.append(label)
    const pivot = document.createElement('span')
    pivot.className = 'pivot-marker'
    pivot.style.left = `${node.rect.pivot.x * 100}%`
    pivot.style.top = `${(1 - node.rect.pivot.y) * 100}%`
    element.append(pivot)
    renderComponents(node, layer, element, resolved)
    element.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
      selectNode(node.id)
    })
    for (const child of children.get(node.id) || []) element.append(createNode(child, children, resolvedRects))
    return element
  }

  function applyRectStyle(element, rect, resolved) {
    element.style.left = `${resolved.x}px`
    element.style.top = `${resolved.y}px`
    element.style.width = `${resolved.width}px`
    element.style.height = `${resolved.height}px`
    element.style.transformOrigin = `${rect.pivot.x * 100}% ${(1 - rect.pivot.y) * 100}%`
    element.style.transform = `rotate(${-rect.localEulerAngles.z}deg) scale(${rect.localScale.x}, ${rect.localScale.y})`
  }

  function renderComponents(node, layer, nodeElement, resolved) {
    const image = node.components.find((component) => component.type === 'image' || component.type === 'raw-image')
    const text = node.components.find((component) => component.type === 'text' || component.type === 'text-mesh-pro')
    const mask = node.components.find((component) => component.type === 'mask')
    if (image && mask?.properties?.showMaskGraphic !== false) renderImage(node, image, layer)
    if (text) renderText(text, layer, resolved)
    if (node.components.some((component) => component.type === 'button')) {
      nodeElement.classList.add('button-node')
      nodeElement.tabIndex = 0
      nodeElement.setAttribute('role', 'button')
      nodeElement.addEventListener('click', () => { elements.status.textContent = `Clicked ${node.name}` })
    }
    if (node.components.some((component) => ['mask', 'rect-mask-2d', 'scroll-rect'].includes(component.type))) nodeElement.classList.add('masked-node')
    const group = node.components.find((component) => component.type === 'canvas-group')
    if (group) {
      nodeElement.style.opacity = numeric(group.properties.m_Alpha, 1)
      if (!truthy(group.properties.m_Interactable, true) || !truthy(group.properties.m_BlocksRaycasts, true)) nodeElement.style.pointerEvents = 'none'
    }
  }

  function renderImage(node, component, layer) {
    const resource = component.resourceId ? current.resources[component.resourceId] : null
    if (!resource || !resource.webPath || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(resource.webPath)) {
      const missing = document.createElement('div')
      missing.className = 'missing-resource'
      missing.textContent = resource?.sourcePath?.split(/[\\/]/).pop() || 'missing'
      layer.append(missing)
      return
    }
    const canvas = document.createElement('canvas')
    canvas.className = 'image-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    layer.append(canvas)
    const redraw = () => drawImage(canvas, component, resource)
    requestAnimationFrame(redraw)
    loadImage(resource.webPath).then(redraw, redraw)
  }

  async function drawImage(canvas, component, resource) {
    const image = await loadImage(resource.webPath).catch(() => null)
    if (!image) return
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    const context = canvas.getContext('2d')
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    context.imageSmoothingEnabled = true
    const sprite = resource.sprite || { rect: { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }, border: { left: 0, right: 0, top: 0, bottom: 0 }, pixelsPerUnit: 100 }
    const source = { x: sprite.rect.x, y: image.naturalHeight - sprite.rect.y - sprite.rect.height, width: sprite.rect.width, height: sprite.rect.height }
    if (component.imageType === 'sliced') drawSliced(context, image, source, sprite.border, width, height, component, sprite.pixelsPerUnit)
    else if (component.imageType === 'tiled') drawTiled(context, image, source, width, height)
    else if (component.imageType === 'filled') drawFilled(context, image, source, width, height, component)
    else drawSimple(context, image, source, width, height, component.preserveAspect)
    canvas.style.opacity = String(component.color.a)
  }

  function drawSimple(context, image, source, width, height, preserveAspect) {
    let dx = 0, dy = 0, dw = width, dh = height
    if (preserveAspect && source.width && source.height) {
      const scale = Math.min(width / source.width, height / source.height)
      dw = source.width * scale; dh = source.height * scale; dx = (width - dw) / 2; dy = (height - dh) / 2
    }
    context.drawImage(image, source.x, source.y, source.width, source.height, dx, dy, dw, dh)
  }

  function drawSliced(context, image, source, border, width, height, component, pixelsPerUnit) {
    const unit = current.canvas.referencePixelsPerUnit / Math.max(1, pixelsPerUnit || 100) / Math.max(.0001, component.pixelsPerUnitMultiplier || 1)
    let dl = border.left * unit, dr = border.right * unit, dt = border.top * unit, db = border.bottom * unit
    const horizontalScale = Math.min(1, width / Math.max(1, dl + dr))
    const verticalScale = Math.min(1, height / Math.max(1, dt + db))
    dl *= horizontalScale; dr *= horizontalScale; dt *= verticalScale; db *= verticalScale
    const sx = [source.x, source.x + border.left, source.x + source.width - border.right]
    const sy = [source.y, source.y + border.top, source.y + source.height - border.bottom]
    const sw = [border.left, Math.max(0, source.width - border.left - border.right), border.right]
    const sh = [border.top, Math.max(0, source.height - border.top - border.bottom), border.bottom]
    const dx = [0, dl, width - dr], dy = [0, dt, height - db]
    const dw = [dl, Math.max(0, width - dl - dr), dr], dh = [dt, Math.max(0, height - dt - db), db]
    for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
      if (!component.fillCenter && row === 1 && column === 1) continue
      if (sw[column] > 0 && sh[row] > 0 && dw[column] > 0 && dh[row] > 0) context.drawImage(image, sx[column], sy[row], sw[column], sh[row], dx[column], dy[row], dw[column], dh[row])
    }
  }

  function drawTiled(context, image, source, width, height) {
    const tile = document.createElement('canvas')
    tile.width = Math.max(1, source.width); tile.height = Math.max(1, source.height)
    tile.getContext('2d').drawImage(image, source.x, source.y, source.width, source.height, 0, 0, tile.width, tile.height)
    const pattern = context.createPattern(tile, 'repeat')
    if (pattern) { context.fillStyle = pattern; context.fillRect(0, 0, width, height) }
  }

  function drawFilled(context, image, source, width, height, component) {
    const amount = Math.max(0, Math.min(1, component.fillAmount))
    context.save()
    if (component.fillMethod === 0) {
      const fillWidth = width * amount
      context.beginPath(); context.rect(component.fillOrigin === 1 ? width - fillWidth : 0, 0, fillWidth, height); context.clip()
    } else if (component.fillMethod === 1) {
      const fillHeight = height * amount
      context.beginPath(); context.rect(0, component.fillOrigin === 1 ? 0 : height - fillHeight, width, fillHeight); context.clip()
    } else {
      const centerX = width / 2, centerY = height / 2
      const start = -Math.PI / 2 + (component.fillOrigin || 0) * Math.PI / 2
      const direction = component.fillClockwise ? 1 : -1
      context.beginPath(); context.moveTo(centerX, centerY); context.arc(centerX, centerY, Math.hypot(width, height), start, start + direction * Math.PI * 2 * amount, direction < 0); context.closePath(); context.clip()
    }
    drawSimple(context, image, source, width, height, component.preserveAspect)
    context.restore()
  }

  function renderText(component, layer, resolved) {
    const measureContext = document.createElement('canvas').getContext('2d')
    if (!measureContext) return
    const layout = layoutUnityText(measureContext, component, {
      fontFamily: textFontFamily(component),
      width: resolved.width,
      height: resolved.height
    })
    const canvas = document.createElement('canvas')
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.className = 'text-canvas'
    canvas.width = Math.max(1, Math.ceil(layout.bounds.width * ratio))
    canvas.height = Math.max(1, Math.ceil(layout.bounds.height * ratio))
    canvas.style.left = `${layout.bounds.x}px`
    canvas.style.top = `${layout.bounds.y}px`
    canvas.style.width = `${layout.bounds.width}px`
    canvas.style.height = `${layout.bounds.height}px`
    canvas.setAttribute('aria-label', component.text.replace(/<[^>]+>/g, ''))
    const context = canvas.getContext('2d')
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawUnityText(context, layout, component, -layout.bounds.x, -layout.bounds.y)
    layer.append(canvas)
  }

  function renderHierarchy(children) {
    const fragment = document.createDocumentFragment()
    const visit = (node, depth) => {
      const row = document.createElement('button')
      row.type = 'button'; row.className = `hierarchy-row${node.active ? '' : ' inactive'}`; row.dataset.nodeId = node.id
      row.style.paddingLeft = `${8 + depth * 14}px`
      const kind = node.components.find((component) => component.type !== 'unknown')?.type || 'node'
      row.innerHTML = `<span>${escapeHtml(node.name)}</span><span class="hierarchy-kind">${escapeHtml(kind)}</span>`
      row.addEventListener('click', () => selectNode(node.id))
      fragment.append(row)
      for (const child of children.get(node.id) || []) visit(child, depth + 1)
    }
    for (const rootId of current.rootIds) { const root = current.nodes.find((node) => node.id === rootId); if (root) visit(root, 0) }
    elements.hierarchy.append(fragment)
  }

  function selectNode(nodeId) {
    selectedNodeId = nodeId
    document.querySelectorAll('.selected-node,.hierarchy-row.selected').forEach((entry) => entry.classList.remove('selected-node', 'selected'))
    const nodeElement = elements.stage.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)
    const hierarchyElement = elements.hierarchy.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)
    nodeElement?.classList.add('selected-node'); hierarchyElement?.classList.add('selected'); hierarchyElement?.scrollIntoView({ block: 'nearest' })
    const node = current.nodes.find((entry) => entry.id === nodeId)
    elements.inspector.textContent = node ? JSON.stringify({ name: node.name, active: node.active, order: node.order, rect: node.rect, components: node.components.map((component) => component.type) }, null, 2) : ''
  }

  function renderDiagnostics(diagnostics) {
    elements.diagnostics.replaceChildren(); elements.diagnosticCount.textContent = String(diagnostics.length)
    for (const diagnostic of diagnostics) {
      const item = document.createElement('div'); item.className = `diagnostic ${diagnostic.severity}`
      item.innerHTML = `<strong>${escapeHtml(diagnostic.code)}</strong><div>${escapeHtml(diagnostic.message)}</div><small>${escapeHtml(diagnostic.sourcePath || '')}</small>`
      elements.diagnostics.append(item)
    }
  }

  function resizeStage() {
    if (!current) return
    const width = Math.max(1, Number(elements.width.value) || current.canvas.referenceResolution.x)
    const height = Math.max(1, Number(elements.height.value) || current.canvas.referenceResolution.y)
    elements.stage.style.width = `${width}px`; elements.stage.style.height = `${height}px`
    if (fontsReady) renderStage(width, height)
    const availableWidth = Math.max(1, elements.viewport.clientWidth - 40), availableHeight = Math.max(1, elements.viewport.clientHeight - 40)
    const mode = elements.scale.value
    const scale = mode === 'actual' ? 1 : mode === 'width' ? availableWidth / width : mode === 'height' ? availableHeight / height : Math.min(availableWidth / width, availableHeight / height)
    elements.stage.style.transform = `translate(-50%, -50%) scale(${Math.max(.05, scale)})`
  }

  async function installFonts(doc) {
    const loads = []
    for (const resource of Object.values(doc.resources)) {
      if (resource.kind !== 'font' || !resource.webPath) continue
      const face = new FontFace(fontFamily(resource), `url(${JSON.stringify(resource.webPath)})`)
      loads.push(face.load().then((loaded) => document.fonts.add(loaded)))
    }
    await Promise.allSettled(loads)
  }

  function groupByParent(nodes) {
    const result = new Map()
    for (const node of nodes) { const list = result.get(node.parentId) || []; list.push(node); result.set(node.parentId, list) }
    for (const list of result.values()) list.sort((a, b) => a.order - b.order)
    return result
  }

  function loadImage(source) {
    if (!imageCache.has(source)) imageCache.set(source, new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source }))
    return imageCache.get(source)
  }

  function fontFamily(resource) { return `unity-font-${resource.guid || resource.fileId}` }
  function textFontFamily(component) { const resource = component.resourceId ? current.resources[component.resourceId] : null; return resource ? fontFamily(resource) : 'sans-serif' }
  function rgba(color) { return `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${color.a})` }
  function numeric(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback }
  function truthy(value, fallback) { return value === 0 || value === '0' ? false : value === 1 || value === '1' ? true : fallback }
  function escapeHtml(value) { const element = document.createElement('span'); element.textContent = String(value); return element.innerHTML }
})()
