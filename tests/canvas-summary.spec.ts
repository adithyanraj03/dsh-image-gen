import { describe, expect, it } from 'vitest'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { boundsOfElements, describeShape, kindOf, previewOf, selectionKeyOf, selectedElementsOf, summarize, withBoundAndFrameElements } from '../src/client/canvas/canvas-summary.js'
import { CANVAS_MAX_NODES, CANVAS_MAX_PROMPT_CHARS, CANVAS_MAX_SELECTION_ITEMS, CANVAS_MAX_SELECTION_KINDS } from '../src/shared.js'

/** Minimal element factory: only the fields the summary logic reads. */
function element(overrides: Record<string, unknown>): ExcalidrawElement {
  return {
    id: 'e1', type: 'rectangle', x: 0, y: 0, width: 100, height: 80, version: 1, isDeleted: false,
    boundElements: null, frameId: null, customData: undefined, ...overrides,
  } as unknown as ExcalidrawElement
}

function imageElement(customData: Record<string, unknown>, overrides: Record<string, unknown> = {}): ExcalidrawElement {
  return element({ type: 'image', fileId: 'f1', width: 380, height: 285, customData, ...overrides })
}

describe('canvas node kind mapping (host contract)', () => {
  it.each([
    ['image', 'image'], ['freedraw', 'draw'], ['text', 'text'],
    ['rectangle', 'geo'], ['ellipse', 'geo'], ['diamond', 'geo'],
    ['arrow', 'arrow'], ['line', 'arrow'], ['frame', 'frame'],
    ['selection', 'other'], ['embeddable', 'other'], ['iframe', 'other'], ['magicframe', 'other'],
  ])('maps %s to %s', (type, kind) => {
    expect(kindOf(type)).toBe(kind)
  })
})

describe('image provenance readback', () => {
  it('surfaces landing-time provenance and original dimensions', () => {
    const node = describeShape(imageElement({
      galleryId: 'g-1', attachmentId: 'sha256:cat', name: 'cat.png', prompt: 'a  cat', provider: 'google', model: 'gemini', width: 1024, height: 768,
    }))
    expect(node).toEqual({ kind: 'image', galleryId: 'g-1', attachmentId: 'sha256:cat', name: 'cat.png', prompt: 'a cat', provider: 'google', model: 'gemini', width: 1024, height: 768 })
  })

  it('falls back to display size for user-placed images without provenance', () => {
    expect(describeShape(imageElement({}))).toEqual({ kind: 'image', width: 380, height: 285 })
  })

  it('truncates stale untruncated prompts defensively', () => {
    const node = describeShape(imageElement({ prompt: 'x'.repeat(CANVAS_MAX_PROMPT_CHARS + 50) }))
    expect(node.prompt).toHaveLength(CANVAS_MAX_PROMPT_CHARS)
  })

  it('ignores malformed customData fields', () => {
    const node = describeShape(imageElement({ galleryId: 3, attachmentId: '', prompt: '   ', provider: '', model: null, name: '' }))
    expect(node).toEqual({ kind: 'image', width: 380, height: 285 })
  })
})

describe('text and geo summaries', () => {
  it('previews text with collapsed whitespace and a 96-char cap', () => {
    const node = describeShape(element({ type: 'text', text: '  hello\n  world  ', width: 120.4 }))
    expect(node).toEqual({ kind: 'text', text: 'hello world', width: 120 })
    expect(previewOf('y'.repeat(200))).toHaveLength(96)
    expect(previewOf('   ')).toBeUndefined()
  })

  it('names geo variants after their element type', () => {
    expect(describeShape(element({ type: 'ellipse' }))).toEqual({ kind: 'geo', name: 'ellipse', width: 100, height: 80 })
  })
})

describe('summary caps and dedupe keys (host contract)', () => {
  const appState = { selectedElementIds: {} as Record<string, true> }

  it('caps the inventory, selection items and kinds while counting everything', () => {
    const kinds = ['image', 'freedraw', 'text', 'rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'frame']
    const elements = Array.from({ length: CANVAS_MAX_NODES + 10 }, (_, n) => element({ id: `e${n}`, type: kinds[n % kinds.length] }))
    for (const el of elements) appState.selectedElementIds[el.id] = true
    const summary = summarize(elements, appState)
    expect(summary.nodeCount).toBe(CANVAS_MAX_NODES + 10)
    expect(summary.nodes).toHaveLength(CANVAS_MAX_NODES)
    expect(summary.selectionCount).toBe(CANVAS_MAX_NODES + 10)
    expect(summary.selectionItems).toHaveLength(CANVAS_MAX_SELECTION_ITEMS)
    expect(summary.selectionKinds.length).toBeLessThanOrEqual(CANVAS_MAX_SELECTION_KINDS)
  })

  it('keeps stateKey stable for identical state and sensitive to selection identity', () => {
    const elements = [imageElement({ galleryId: 'g-1' }, { id: 'a' }), element({ id: 'b', type: 'freedraw' })]
    const first = summarize(elements, { selectedElementIds: { a: true } })
    const same = summarize(elements, { selectedElementIds: { a: true } })
    const other = summarize(elements, { selectedElementIds: { b: true } })
    expect(first.stateKey).toBe(same.stateKey)
    expect(first.selectionKey).toBe('a')
    expect(other.selectionKey).toBe('b')
    expect(first.stateKey).not.toBe(other.stateKey)
    expect(selectionKeyOf({ selectedElementIds: {} })).toBe('none')
    expect(selectionKeyOf({ selectedElementIds: { b: true, a: true } })).toBe('a|b')
  })

  it('detects edits to a selected element beyond the inventory cap', () => {
    const elements = Array.from({ length: CANVAS_MAX_NODES + 1 }, (_, n) => element({ id: `e${n}` }))
    const last = elements[elements.length - 1]!
    const before = summarize(elements, { selectedElementIds: { [last.id]: true } })
    const edited = elements.map(el => el.id === last.id ? element({ ...el, width: 999 }) : el)
    const after = summarize(edited, { selectedElementIds: { [last.id]: true } })
    expect(before.stateKey).not.toBe(after.stateKey)
  })

  it('selects only non-deleted marked elements in scene order', () => {
    const elements = [element({ id: 'a' }), element({ id: 'b', isDeleted: true }), element({ id: 'c' })]
    expect(selectedElementsOf(elements, { selectedElementIds: { a: true, b: true, c: true } }).map(el => el.id)).toEqual(['a', 'c'])
  })
})

describe('export context expansion', () => {
  it('includes bound text and frame children, excludes deleted elements', () => {
    const frame = element({ id: 'frame', type: 'frame' })
    const child = element({ id: 'child', frameId: 'frame' })
    const rect = element({ id: 'rect', boundElements: [{ id: 'label', type: 'text' }] })
    const label = element({ id: 'label', type: 'text', containerId: 'rect', text: 'note' })
    const dead = element({ id: 'dead', isDeleted: true, frameId: 'frame' })
    const all = [frame, child, rect, label, dead]
    expect(withBoundAndFrameElements([frame, rect], all).map(el => el.id)).toEqual(['frame', 'child', 'rect', 'label'])
  })

  it('computes axis-aligned bounds', () => {
    expect(boundsOfElements([element({ x: 10, y: 20, width: 100, height: 50 }), element({ x: -5, y: 0, width: 10, height: 10 })]))
      .toEqual({ minX: -5, minY: 0, maxX: 110, maxY: 70, w: 115, h: 70 })
    expect(boundsOfElements([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 })
  })
})
