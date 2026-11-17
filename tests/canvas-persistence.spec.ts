import { describe, expect, it } from 'vitest'
import type { AppState } from '@excalidraw/excalidraw/types'
import { CANVAS_PERSISTENCE_KEY, loadPersistedCanvas, pickPersistedAppState, pruneUnusedFiles, serializeCanvasSnapshot } from '../src/client/canvas/canvas-persistence.js'

const appState = {
  scrollX: 12, scrollY: -30, zoom: { value: 1.5 },
  viewBackgroundColor: 'transparent', gridSize: 20, gridStep: 5,
  currentItemStrokeColor: '#2f64f5', currentItemBackgroundColor: 'transparent',
  currentItemFillStyle: 'solid', currentItemStrokeWidth: 2, currentItemStrokeStyle: 'solid',
  currentItemRoughness: 1, currentItemOpacity: 100, currentItemFontFamily: 5,
  currentItemFontSize: 20, currentItemTextAlign: 'left', currentItemRoundness: 'round',
  objectsSnapModeEnabled: true,
  // Interaction state that must never persist:
  selectedElementIds: { e1: true }, openDialog: { name: 'help' }, theme: 'dark',
  collaborators: new Map(), contextMenu: null,
} as unknown as AppState

const elements = [
  { id: 'e1', type: 'image', fileId: 'f1', isDeleted: false },
  { id: 'e2', type: 'image', fileId: 'f2', isDeleted: true },
  { id: 'e3', type: 'freedraw', fileId: null, isDeleted: false },
] as any[]

const files = {
  f1: { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', created: 1 },
  f2: { id: 'f2', mimeType: 'image/png', dataURL: 'data:image/png;base64,BB==', created: 1 },
  orphan: { id: 'orphan', mimeType: 'image/png', dataURL: 'data:image/png;base64,CC==', created: 1 },
} as any

describe('canvas persistence snapshots', () => {
  it('keeps the storage identity of the previous editor', () => {
    expect(CANVAS_PERSISTENCE_KEY).toBe('dsh-image-gen-workbench-v1')
  })

  it('persists camera and drawing style but never selection or dialogs', () => {
    const picked = pickPersistedAppState(appState)
    expect(picked.scrollX).toBe(12)
    expect(picked.zoom).toEqual({ value: 1.5 })
    expect(picked.currentItemStrokeColor).toBe('#2f64f5')
    expect(picked.objectsSnapModeEnabled).toBe(true)
    expect(picked).not.toHaveProperty('selectedElementIds')
    expect(picked).not.toHaveProperty('openDialog')
    expect(picked).not.toHaveProperty('collaborators')
    expect(picked).not.toHaveProperty('contextMenu')
  })

  it('prunes orphan files but keeps files of deleted elements for undo', () => {
    const kept = pruneUnusedFiles(elements, files)
    expect(Object.keys(kept).sort()).toEqual(['f1', 'f2'])
  })

  it('serializes a complete restorable snapshot', () => {
    const snapshot = serializeCanvasSnapshot(elements, appState, files)
    expect(snapshot.elements).toHaveLength(3)
    expect(Object.keys(snapshot.files).sort()).toEqual(['f1', 'f2'])
    expect(snapshot.appState.selectedElementIds).toBeUndefined()
    expect(typeof snapshot.savedAt).toBe('number')
  })

  it('degrades to an empty canvas when IndexedDB is unavailable', async () => {
    expect(typeof indexedDB).toBe('undefined')
    expect(await loadPersistedCanvas()).toBeNull()
  })
})
