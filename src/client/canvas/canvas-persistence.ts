/**
 * Local persistence for the workbench canvas document (elements + files +
 * camera/style appState), keyed like the old editor's persistenceKey so the
 * storage identity stays stable across the editor swap.
 *
 * IndexedDB instead of localStorage: image bytes live in the files map as
 * dataURLs and routinely exceed the ~5MB localStorage quota. The pure
 * snapshot helpers are exported separately so node tests exercise them
 * without an IndexedDB implementation.
 */
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'

/** Same storage identity the previous editor used for its persisted document. */
export const CANVAS_PERSISTENCE_KEY = 'dsh-image-gen-workbench-v1'
const STORE_NAME = 'canvas'
const RECORD_KEY = 'scene'

export interface PersistedCanvasState {
  elements: ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
  savedAt: number
}

/** Camera + drawing-style state worth restoring; selection is interaction
 *  state and deliberately never persisted (every mount starts fresh). */
const PERSISTED_APP_STATE_KEYS = [
  'scrollX', 'scrollY', 'zoom', 'viewBackgroundColor', 'gridSize', 'gridStep',
  'currentItemStrokeColor', 'currentItemBackgroundColor', 'currentItemFillStyle',
  'currentItemStrokeWidth', 'currentItemStrokeStyle', 'currentItemRoughness',
  'currentItemOpacity', 'currentItemFontFamily', 'currentItemFontSize',
  'currentItemTextAlign', 'currentItemRoundness', 'objectsSnapModeEnabled',
] as const satisfies readonly (keyof AppState)[]

export function pickPersistedAppState(appState: AppState): Partial<AppState> {
  const picked: Partial<AppState> = {}
  for (const key of PERSISTED_APP_STATE_KEYS) {
    const value = appState[key]
    if (value !== undefined) (picked as Record<string, unknown>)[key] = value
  }
  return picked
}

/** Drop files no element references anymore (deleted elements included, so
 *  undo can still restore their images). */
export function pruneUnusedFiles(elements: readonly ExcalidrawElement[], files: BinaryFiles): BinaryFiles {
  const used = new Set<string>()
  for (const element of elements) {
    if (element.type === 'image' && element.fileId !== null) used.add(element.fileId)
  }
  const kept: BinaryFiles = {}
  for (const [id, file] of Object.entries(files)) {
    if (used.has(id)) kept[id] = file
  }
  return kept
}

export function serializeCanvasSnapshot(elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles): PersistedCanvasState {
  return {
    elements: [...elements],
    appState: pickPersistedAppState(appState),
    files: pruneUnusedFiles(elements, files),
    savedAt: Date.now(),
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CANVAS_PERSISTENCE_KEY, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('canvas-storage-open-failed'))
    request.onblocked = () => reject(new Error('canvas-storage-blocked'))
  })
}

/** Load the persisted document, or null when absent/unreadable (private mode). */
export async function loadPersistedCanvas(): Promise<PersistedCanvasState | null> {
  if (typeof indexedDB === 'undefined') return null
  let database: IDBDatabase | undefined
  try {
    database = await openDatabase()
    const record = await new Promise<unknown>((resolve, reject) => {
      const request = database!.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_KEY)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('canvas-storage-read-failed'))
    })
    if (typeof record !== 'object' || record === null) return null
    const state = record as Partial<PersistedCanvasState>
    if (!Array.isArray(state.elements)) return null
    return {
      elements: state.elements,
      appState: typeof state.appState === 'object' && state.appState !== null ? state.appState : {},
      files: typeof state.files === 'object' && state.files !== null ? state.files : {},
      savedAt: typeof state.savedAt === 'number' ? state.savedAt : 0,
    }
  } catch {
    return null
  } finally {
    database?.close()
  }
}

/** Best-effort write; callers treat rejection as non-fatal. */
export async function savePersistedCanvas(snapshot: PersistedCanvasState): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  let database: IDBDatabase | undefined
  try {
    database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const request = database!.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(snapshot, RECORD_KEY)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('canvas-storage-write-failed'))
    })
  } finally {
    database?.close()
  }
}
