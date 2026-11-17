/**
 * Pure canvas-summary logic shared by the host sync and its tests.
 *
 * No browser-only or Excalidraw runtime imports live here: Excalidraw types
 * are type-only, so node vitest suites exercise the real host-contract code
 * (kind mapping, provenance readback, caps, dedupe keys) without a DOM.
 */
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState } from '@excalidraw/excalidraw/types'
import { CANVAS_MAX_NODES, CANVAS_MAX_PROMPT_CHARS, CANVAS_MAX_SELECTION_ITEMS, CANVAS_MAX_SELECTION_KINDS, type CanvasNodeKind, type CanvasNodeSummary } from '../../shared.js'

const MAX_TEXT_CHARS = 96

/** Generation provenance stored on image elements at landing time (customData). */
export interface CanvasImageProvenance {
  galleryId?: string
  attachmentId?: string
  name?: string
  prompt?: string
  provider?: string
  model?: string
  /** Original pixel dimensions (the element itself carries display size). */
  width?: number
  height?: number
  fromConversation?: boolean
}

/** Map an Excalidraw element type onto the coarse model-facing node kind. */
export function kindOf(elementType: string): CanvasNodeKind {
  switch (elementType) {
    case 'image': return 'image'
    case 'freedraw': return 'draw'
    case 'text': return 'text'
    case 'rectangle':
    case 'ellipse':
    case 'diamond': return 'geo'
    case 'arrow':
    case 'line': return 'arrow'
    case 'frame': return 'frame'
    default: return 'other'
  }
}

export function previewOf(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length === 0 ? undefined : collapsed.slice(0, MAX_TEXT_CHARS)
}

export function provenanceOf(element: ExcalidrawElement): CanvasImageProvenance {
  const data = element.customData
  return typeof data === 'object' && data !== null ? data as CanvasImageProvenance : {}
}

/**
 * Summarize one element for the model. Used both for the canvas inventory and
 * for the selection identity list, so a selected node reads exactly like its
 * canvas node twin (same name, attachment id, dimensions).
 */
export function describeShape(element: ExcalidrawElement): CanvasNodeSummary {
  const node: CanvasNodeSummary = { kind: kindOf(element.type) }
  if (element.type === 'image') {
    const meta = provenanceOf(element)
    if (typeof meta.galleryId === 'string' && meta.galleryId.length > 0) node.galleryId = meta.galleryId
    if (typeof meta.attachmentId === 'string' && meta.attachmentId.length > 0) node.attachmentId = meta.attachmentId
    // Generation provenance written at landing time: lets the model reproduce
    // or precisely vary this image instead of guessing from pixels. Prompt is
    // truncated at landing; slice again defensively so a stale untruncated
    // element cannot bloat the digest.
    if (typeof meta.prompt === 'string' && meta.prompt.trim().length > 0) {
      node.prompt = meta.prompt.replace(/\s+/g, ' ').trim().slice(0, CANVAS_MAX_PROMPT_CHARS)
    }
    if (typeof meta.provider === 'string' && meta.provider.length > 0) node.provider = meta.provider
    if (typeof meta.model === 'string' && meta.model.length > 0) node.model = meta.model
    if (typeof meta.name === 'string' && meta.name.length > 0) node.name = meta.name.slice(0, 128)
    // Original dimensions ride in customData; user-placed images without
    // provenance fall back to their display size.
    const width = typeof meta.width === 'number' && meta.width > 0 ? meta.width : element.width
    const height = typeof meta.height === 'number' && meta.height > 0 ? meta.height : element.height
    node.width = Math.round(width)
    node.height = Math.round(height)
  } else if (element.type === 'text') {
    const preview = previewOf(element.text)
    if (preview !== undefined) node.text = preview
    node.width = Math.round(element.width)
  } else if (element.type === 'rectangle' || element.type === 'ellipse' || element.type === 'diamond') {
    node.name = element.type
    node.width = Math.round(element.width)
    node.height = Math.round(element.height)
  }
  return node
}

/** The non-deleted elements currently in the selection, in scene order. */
export function selectedElementsOf(elements: readonly ExcalidrawElement[], appState: Pick<AppState, 'selectedElementIds'>): ExcalidrawElement[] {
  const selected = appState.selectedElementIds
  return elements.filter(element => !element.isDeleted && selected[element.id] === true)
}

/**
 * Selection identity key: sorted element ids joined with '|', 'none' when the
 * selection is empty. Both the hot change path and `summarize()` call this one
 * function, so the two can never disagree on "did the selection change".
 */
export function selectionKeyOf(appState: Pick<AppState, 'selectedElementIds'>): string {
  const ids = Object.keys(appState.selectedElementIds).sort().join('|')
  return ids.length === 0 ? 'none' : ids
}

/** Cheap document fingerprint: bumps whenever any element is added/edited/deleted. */
export function elementsVersionOf(elements: readonly ExcalidrawElement[]): number {
  let version = elements.length
  for (const element of elements) version += element.version
  return version
}

export interface CanvasSummary {
  nodeCount: number
  nodes: CanvasNodeSummary[]
  selectionCount: number
  selectionKinds: CanvasNodeKind[]
  /** Identity list of the selected elements, capped at the selection-items limit. */
  selectionItems: CanvasNodeSummary[]
  /** Stable key over the summarized state; unchanged key = no HTTP push. */
  stateKey: string
  /** Stable key over just the selection; a change re-arms the screenshot export. */
  selectionKey: string
}

export function summarize(elements: readonly ExcalidrawElement[], appState: Pick<AppState, 'selectedElementIds'>): CanvasSummary {
  const nodes: CanvasNodeSummary[] = []
  for (const element of elements.slice(0, CANVAS_MAX_NODES)) {
    nodes.push(describeShape(element))
  }

  const selected = selectedElementsOf(elements, appState)
  const selectionKinds = [...new Set(selected.map(element => kindOf(element.type)))].slice(0, CANVAS_MAX_SELECTION_KINDS)
  const selectionItems = selected.slice(0, CANVAS_MAX_SELECTION_ITEMS).map(element => describeShape(element))
  const selectionKey = selectionKeyOf(appState)
  return {
    nodeCount: elements.length,
    nodes,
    selectionCount: selected.length,
    selectionKinds,
    selectionItems,
    // selectionItems must join the key: a selected element beyond the
    // CANVAS_MAX_NODES truncation leaves no trace in `nodes`, so editing its
    // content would otherwise change nothing here and the push never fires.
    stateKey: JSON.stringify([elements.length, nodes, selectionKinds, selected.length, selectionItems, selectionKey]),
    selectionKey,
  }
}

/**
 * Expand a selection for screenshot export: bound text renders with its
 * container and frame children render inside their frame, matching what the
 * user sees. Pure scene-order filter over the full element list.
 */
export function withBoundAndFrameElements(shapes: readonly ExcalidrawElement[], allElements: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  const ids = new Set(shapes.map(shape => shape.id))
  for (const shape of shapes) {
    for (const bound of shape.boundElements ?? []) {
      if (bound.type === 'text') ids.add(bound.id)
    }
  }
  for (const element of allElements) {
    if (element.isDeleted) continue
    if (element.frameId !== null && ids.has(element.frameId)) ids.add(element.id)
    if (element.type === 'text' && element.containerId !== null && ids.has(element.containerId)) ids.add(element.id)
  }
  return allElements.filter(element => !element.isDeleted && ids.has(element.id))
}

/** Axis-aligned scene bounds of a set of elements (rotation-insensitive). */
export function boundsOfElements(elements: readonly ExcalidrawElement[]): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const element of elements) {
    minX = Math.min(minX, element.x)
    minY = Math.min(minY, element.y)
    maxX = Math.max(maxX, element.x + element.width)
    maxY = Math.max(maxY, element.y + element.height)
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}
