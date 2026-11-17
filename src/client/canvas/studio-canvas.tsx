import { memo, useCallback, useEffect, useRef, useState, type FC } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImageElement, FileId } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFileData, ExcalidrawImperativeAPI, NormalizedZoomValue } from '@excalidraw/excalidraw/types'
import type { CaptureUpdateActionType } from '@excalidraw/excalidraw/store'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { blobToDataUrl } from '../browser-image-utils.js'
import { clearAttachmentCache, fetchAttachmentBlob } from '../image-cache.js'
import { CANVAS_MAX_PROMPT_CHARS } from '../../shared.js'
import { hostTheme, syncCanvasThemeWithHost } from './canvas-brand-theme.js'
import { CANVAS_DOT_GRID } from './canvas-brand-tokens.js'
import { startCanvasSync, type CanvasSyncStatus } from './canvas-sync.js'
import { clearCanvasLandings, getCanvasLandingGeneration, registerCanvasLandingConsumer, type CanvasLandingItem } from './canvas-bridge.js'
import { GALLERY_IMAGE_MIME, readGalleryImageDrop } from './gallery-image-transfer.js'
import { loadPersistedCanvas, savePersistedCanvas, serializeCanvasSnapshot } from './canvas-persistence.js'
import { provenanceOf } from './canvas-summary.js'
import { clientToScenePoint, isPlainLeftClick, isPlacementSurfaceTarget, type PlacementPointer } from './canvas-placement.js'

/**
 * Infinite canvas surface for the Studio workbench, backed by Excalidraw
 * (MIT; no watermark, no license key).
 *
 * The document (elements + image files + camera) persists locally under the
 * same storage identity the previous editor used. The landing queue is
 * consumed once; Excalidraw owns subsequent edits, deletion, undo and redo.
 */

const MAX_DISPLAY_SIDE = 380
const GRID_GAP = 40
const GRID_COLS = 3
/** Idle time before the document snapshot is written to IndexedDB. */
const SAVE_DEBOUNCE_MS = 800

const mountedCanvases = new Set<() => void>()
const mountedEditors = new Set<ExcalidrawImperativeAPI>()

/** Reset canvas-owned data only. Gallery records and host attachments are untouched. */
export function clearStudioCanvases(): boolean {
  if (mountedCanvases.size === 0) return false
  clearCanvasLandings()
  for (const clear of mountedCanvases) clear()
  clearAttachmentCache()
  return true
}

/**
 * Cancel in-editor selection on every mounted canvas, keeping elements and
 * sync untouched. Selection is interaction state tied to the surface: leaving
 * the studio page cancels it so a stale selection can neither resurface on
 * return nor linger in the host mirror.
 */
export function deselectStudioCanvases(): boolean {
  if (mountedEditors.size === 0) return false
  for (const api of mountedEditors) api.updateScene({ appState: { selectedElementIds: {} } })
  return true
}

function fileIdFor(galleryId: string): FileId {
  return `ig-${galleryId.replace(/[^A-Za-z0-9_-]/g, '_')}` as FileId
}

function displaySizeOf(attachment: ImageAttachmentRef): { w: number; h: number } {
  const width = attachment.width > 0 ? attachment.width : 512
  const height = attachment.height > 0 ? attachment.height : 512
  const scale = MAX_DISPLAY_SIDE / Math.max(width, height)
  return { w: Math.round(width * scale), h: Math.round(height * scale) }
}

/** Dedupe across the whole live document. Deleted elements are excluded, so a
 *  deliberate delete allows a later re-import of the same gallery image. */
function landedIdsOf(api: ExcalidrawImperativeAPI): Set<string> {
  const landedIds = new Set<string>()
  for (const element of api.getSceneElements()) {
    if (element.type !== 'image') continue
    const galleryId = provenanceOf(element).galleryId
    if (typeof galleryId === 'string') landedIds.add(galleryId)
  }
  return landedIds
}

/** Truncate the prompt copied onto an element: the canvas digest stays compact. */
function metaPromptOf(prompt: string | undefined): string | undefined {
  if (typeof prompt !== 'string') return undefined
  const collapsed = prompt.replace(/\s+/g, ' ').trim()
  return collapsed.length === 0 ? undefined : collapsed.slice(0, CANVAS_MAX_PROMPT_CHARS)
}

/** Scene-space viewport rectangle derived from Excalidraw's camera state. */
function viewportOf(appState: Pick<AppState, 'scrollX' | 'scrollY' | 'zoom' | 'width' | 'height'>) {
  const zoom = appState.zoom.value
  const minX = -appState.scrollX / zoom
  const minY = -appState.scrollY / zoom
  const maxX = (appState.width - appState.scrollX) / zoom
  const maxY = (appState.height - appState.scrollY) / zoom
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } }
}

function randomNonce(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}

/** Excalidraw restores the persisted document asynchronously after mount;
 *  landings must not race that restore (updateScene would be overwritten). */
async function waitSceneReady(api: ExcalidrawImperativeAPI): Promise<void> {
  const deadline = Date.now() + 5000
  while (api.getAppState().isLoading === true && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** One fetched landing, ready to become an image element. */
interface LandedCell {
  galleryId: string
  fileId: FileId
  w: number
  h: number
  origW: number
  origH: number
  attachmentId: string
  name: string
  fromConversation: boolean
  prompt?: string
  provider?: string
  model?: string
}

/**
 * The single image-element factory for every landing path (grid batches,
 * drag-and-drop and click-to-place): identical provenance customData, undo
 * capture, persistence and host sync regardless of how the image arrived.
 */
function landingElementOf(cell: LandedCell, x: number, y: number): ExcalidrawImageElement {
  return {
    id: `ig-${cell.galleryId}`,
    type: 'image',
    x: Math.round(x),
    y: Math.round(y),
    width: cell.w,
    height: cell.h,
    angle: 0 as ExcalidrawImageElement['angle'],
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: randomNonce(),
    version: 1,
    versionNonce: randomNonce(),
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    fileId: cell.fileId,
    status: 'saved',
    scale: [1, 1],
    crop: null,
    // Generation provenance rides on customData: canvas-sync surfaces it
    // in the model-facing digest so "regenerate this" reuses the original
    // params, and syncCanvasOriginal finds the original bytes via fileId.
    customData: {
      galleryId: cell.galleryId,
      attachmentId: cell.attachmentId,
      name: cell.name,
      fromConversation: cell.fromConversation,
      width: cell.origW,
      height: cell.origH,
      ...(cell.prompt !== undefined ? { prompt: cell.prompt } : {}),
      ...(cell.provider !== undefined ? { provider: cell.provider } : {}),
      ...(cell.model !== undefined ? { model: cell.model } : {}),
    },
  }
}

export interface LandCanvasOptions {
  /**
   * Scene-space point to center a single image on (click-to-place). An
   * explicit anchor overrides the grid layout, the occupied-space fallback
   * and the camera recentering; the caller passes exactly one item.
   */
  anchor?: { x: number; y: number } | undefined
}

export async function landCanvasItems(api: ExcalidrawImperativeAPI, items: readonly CanvasLandingItem[], isActive: () => boolean, onUnreadable?: () => void, options?: LandCanvasOptions): Promise<boolean> {
  // Only yield when a restore is actually in flight, so a ready canvas keeps
  // the synchronous drop-to-fetch path.
  if (api.getAppState().isLoading === true) await waitSceneReady(api)
  if (!isActive()) return false
  // Explicit saves may request an image that is already in the document.
  const landedIds = landedIdsOf(api)
  const pending = items.filter(item => !landedIds.has(item.galleryId))
  if (pending.length === 0) return true

  const files: BinaryFileData[] = []
  const landed: LandedCell[] = []
  for (const item of pending) {
    if (!isActive()) return false
    const fileId = fileIdFor(item.galleryId)
    if (api.getFiles()[fileId] === undefined) {
      try {
        const blob = await fetchAttachmentBlob(item.attachment)
        const dataURL = await blobToDataUrl(blob)
        files.push({
          id: fileId,
          mimeType: (blob.type || item.attachment.mediaType) as BinaryFileData['mimeType'],
          dataURL: dataURL as BinaryFileData['dataURL'],
          created: Date.now(),
          lastRetrieved: Date.now(),
        })
      } catch (error) {
        console.warn('[dsh-image-gen] canvas landing skipped (attachment unreadable):', item.galleryId, error)
        if (isActive()) onUnreadable?.()
        continue
      }
    }
    const size = displaySizeOf(item.attachment)
    const prompt = metaPromptOf(item.prompt)
    landed.push({
      galleryId: item.galleryId,
      fileId,
      attachmentId: String(item.attachment.attachmentId),
      name: item.attachment.name ?? item.galleryId,
      fromConversation: item.fromConversation === true,
      w: size.w,
      h: size.h,
      origW: item.attachment.width > 0 ? item.attachment.width : 512,
      origH: item.attachment.height > 0 ? item.attachment.height : 512,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(typeof item.provider === 'string' && item.provider.length > 0 ? { provider: item.provider } : {}),
      ...(typeof item.model === 'string' && item.model.length > 0 ? { model: item.model } : {}),
    })
  }
  if (!isActive()) return false
  // A second surface/tab may have synchronized this image during the fetch.
  const nowLanded = landedIdsOf(api)
  const ready = landed.filter(item => !nowLanded.has(item.galleryId))
  if (ready.length === 0) return true
  if (files.length > 0) api.addFiles(files)
  // Keep deleted elements in the scene so earlier deletions stay undoable.
  const captureUpdate: CaptureUpdateActionType = 'IMMEDIATELY'

  const anchor = options?.anchor
  if (anchor !== undefined) {
    // Click-to-place: one image centered on the clicked scene point, at the
    // same display size a drag-and-drop landing would use. The user chose
    // the spot, so no occupied-space fallback and no camera movement.
    const cell = ready[0]!
    const element = landingElementOf(cell, anchor.x - cell.w / 2, anchor.y - cell.h / 2)
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), element], captureUpdate })
    return true
  }

  // Layout: rows of up to GRID_COLS images. The block prefers the viewport
  // center; when that spot is already occupied it drops below all existing
  // content, so consecutive batches never stack on top of each other.
  const rows: Array<typeof ready> = []
  for (let index = 0; index < ready.length; index += GRID_COLS) rows.push(ready.slice(index, index + GRID_COLS))
  const rowSizes = rows.map(row => ({
    width: row.reduce((sum, cell) => sum + cell.w, 0) + GRID_GAP * (row.length - 1),
    height: Math.max(...row.map(cell => cell.h)),
  }))
  const blockWidth = Math.max(...rowSizes.map(size => size.width))
  const blockHeight = rowSizes.reduce((sum, size) => sum + size.height, 0) + GRID_GAP * (rows.length - 1)
  const appState = api.getAppState()
  const viewport = viewportOf(appState)
  const originX = viewport.center.x - blockWidth / 2
  let originY = viewport.center.y - blockHeight / 2

  const existing = api.getSceneElements()
  if (existing.length > 0) {
    // Cushion the candidate by half a gap so landed batches keep breathing room.
    const cushion = GRID_GAP / 2
    const candidateX = originX - cushion
    const candidateY = originY - cushion
    const candidateW = blockWidth + cushion * 2
    const candidateH = blockHeight + cushion * 2
    let occupied = false
    let contentBottom = Number.NEGATIVE_INFINITY
    for (const element of existing) {
      const maxX = element.x + element.width
      const maxY = element.y + element.height
      if (maxY > contentBottom) contentBottom = maxY
      if (!occupied
        && candidateX < maxX && candidateX + candidateW > element.x
        && candidateY < maxY && candidateY + candidateH > element.y) {
        occupied = true
      }
    }
    if (occupied) originY = contentBottom + GRID_GAP
  }
  let cursorY = originY
  const elements: ExcalidrawImageElement[] = []
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!
    const rowSize = rowSizes[rowIndex]!
    let cursorX = originX + (blockWidth - rowSize.width) / 2
    for (const cell of row) {
      elements.push(landingElementOf(cell, cursorX, cursorY))
      cursorX += cell.w + GRID_GAP
    }
    cursorY += rowSize.height + GRID_GAP
  }
  api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...elements], captureUpdate })

  // When the batch landed outside the visible viewport (e.g. below older
  // content), bring it into view: pan if it fits at the current zoom,
  // otherwise zoom out just enough to frame it.
  const visible = originX >= viewport.minX && originY >= viewport.minY
    && originX + blockWidth <= viewport.maxX && originY + blockHeight <= viewport.maxY
  if (!visible) {
    if (blockWidth <= viewport.w && blockHeight <= viewport.h) {
      const zoom = appState.zoom.value
      api.updateScene({
        appState: {
          scrollX: appState.width / 2 - (originX + blockWidth / 2) * zoom,
          scrollY: appState.height / 2 - (originY + blockHeight / 2) * zoom,
        },
      })
    } else {
      api.scrollToContent(elements, { fitToContent: true, animate: true, duration: 240, viewportZoomFactor: 0.9 })
    }
  }
  return true
}

export interface PlacementClickHooks {
  /** Disarm as soon as the click commits to the landing path. */
  onPlaced(): void
  onUnreadable(): void
  /** False once the owning canvas detaches (the component's apiRef gate). */
  isMounted(): boolean
}

/**
 * Drive one click-to-place gesture against the real landing path. Returns
 * true when the armed image was committed (the caller disarms); false keeps
 * the arm so a stray click never consumes it. Exported separately from the
 * component so node tests drive it with a mock API and a fake mount rect.
 */
export function placeArmedItemClick(
  api: ExcalidrawImperativeAPI | null,
  container: { getBoundingClientRect(): { left: number; top: number } } | null,
  item: CanvasLandingItem | null,
  down: (PlacementPointer & { surface: boolean }) | null,
  up: PlacementPointer & { target?: unknown },
  hooks: PlacementClickHooks,
): boolean {
  if (api === null || container === null || item === null || down === null) return false
  if (!isPlainLeftClick(down, up)) return false
  // Both press and release must sit on the drawing canvas, never on
  // Excalidraw's toolbars/menus/panels.
  if (!down.surface || !isPlacementSurfaceTarget(up.target)) return false
  const rect = container.getBoundingClientRect()
  const appState = api.getAppState()
  const anchor = clientToScenePoint(up, rect, { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value })
  hooks.onPlaced()
  const generation = getCanvasLandingGeneration()
  void landCanvasItems(api, [item], () => hooks.isMounted() && generation === getCanvasLandingGeneration(), hooks.onUnreadable, { anchor })
    .catch(error => {
      if (hooks.isMounted()) hooks.onUnreadable()
      console.warn('[dsh-image-gen] click-to-place failed:', error)
    })
  return true
}

/** Camera-locked dot grid painted behind the transparent editor canvas. */
function updateDotGrid(container: HTMLDivElement | null, appState: Pick<AppState, 'scrollX' | 'scrollY' | 'zoom'>): void {
  if (!container) return
  const size = CANVAS_DOT_GRID * appState.zoom.value
  container.style.setProperty('--ig-dot-size', `${size}px`)
  container.style.setProperty('--ig-dot-x', `${appState.scrollX}px`)
  container.style.setProperty('--ig-dot-y', `${appState.scrollY}px`)
  container.style.setProperty('--ig-dot-opacity', size < 7 ? '0' : size < 12 ? '0.5' : '1')
}

export interface StudioCanvasHooks {
  setSyncStatus(status: CanvasSyncStatus): void
  setLandingError(value: boolean): void
  getContainer(): HTMLDivElement | null
  /** Called on detach so the component can gate its drag/drop handlers. */
  onDetach?: () => void
}

export interface StudioCanvasHandle {
  (): void
  /** Re-arm the host mirror after a sync failure (status-pill Retry). */
  retry(): void
}

/**
 * Wire one ready Excalidraw instance into the plugin: theme sync, landing
 * queue, host mirror, local persistence and the clear-canvas action. Exported
 * separately from the component so node tests drive the real wiring with a
 * mock API (the component effect is a thin call into this function).
 */
export function attachStudioCanvas(api: ExcalidrawImperativeAPI, hooks: StudioCanvasHooks): StudioCanvasHandle {
  let active = true
  mountedEditors.add(api)
  // Every mount starts as fresh interaction state, even when the persisted
  // document carried a selection.
  api.updateScene({ appState: { selectedElementIds: {} } })
  // Follow the DSH host's light/dark theme, now and on later flips.
  const stopThemeSync = syncCanvasThemeWithHost(api)
  // One console line proves the editor booted inside the webview; useful
  // when the host page swallows render errors.
  console.info(`[dsh-image-gen] excalidraw mounted (instance ${api.id})`)
  const stopLanding = registerCanvasLandingConsumer(items => {
    const generation = getCanvasLandingGeneration()
    hooks.setLandingError(false)
    return landCanvasItems(api, items, () => active && generation === getCanvasLandingGeneration(), () => hooks.setLandingError(true))
  })
  // Mirror this canvas into the host so the conversation agent can see it
  // (canvas_state / view_canvas / edit_image canvas_selection).
  let stopSync = startCanvasSync(api, hooks.setSyncStatus)
  const rearmSync = (): void => { stopSync = startCanvasSync(api, hooks.setSyncStatus) }

  // Local persistence + camera-locked dot grid, both driven by scene changes.
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const saveNow = (): void => {
    if (saveTimer !== undefined) { clearTimeout(saveTimer); saveTimer = undefined }
    void savePersistedCanvas(serializeCanvasSnapshot(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles())).catch(() => {})
  }
  const stopChanges = api.onChange((_elements, appState) => {
    updateDotGrid(hooks.getContainer(), appState)
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { saveTimer = undefined; saveNow() }, SAVE_DEBOUNCE_MS)
  })
  // Flush before the page goes away so a closed tab never loses the last
  // debounce window of edits.
  const flushOnHide = (): void => { saveNow() }
  const flushOnVisibility = (): void => { if (document.visibilityState === 'hidden') saveNow() }
  const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined'
  if (hasDom) {
    window.addEventListener('pagehide', flushOnHide)
    document.addEventListener('visibilitychange', flushOnVisibility)
  }

  const clear = (): void => {
    hooks.setLandingError(false)
    // Stop outstanding screenshots as well as the old host selection.
    stopSync()
    api.resetScene()
    api.history.clear()
    api.updateScene({
      appState: {
        selectedElementIds: {},
        viewBackgroundColor: 'transparent',
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 as NormalizedZoomValue },
        theme: hostTheme(),
      },
    })
    rearmSync()
    saveNow()
  }
  mountedCanvases.add(clear)
  const detach = (): void => {
    active = false
    mountedEditors.delete(api)
    mountedCanvases.delete(clear)
    stopLanding()
    stopThemeSync()
    stopSync()
    stopChanges()
    if (hasDom) {
      window.removeEventListener('pagehide', flushOnHide)
      document.removeEventListener('visibilitychange', flushOnVisibility)
    }
    saveNow()
    hooks.onDetach?.()
  }
  return Object.assign(detach, { retry: () => stopSync.retry() })
}

export const StudioCanvas: FC<{
  lang?: 'zh' | 'en'
  /** Image armed for click-to-place; null/undefined keeps plain canvas clicks. */
  placeItem?: CanvasLandingItem | null | undefined
  /** Disarm callback: a placement click committed (or the arm was cancelled). */
  onPlaced?: (() => void) | undefined
}> = memo(function StudioCanvas({ lang = 'zh', placeItem = null, onPlaced }) {
  const [syncStatus, setSyncStatus] = useState<CanvasSyncStatus>({ phase: 'idle', count: 0 })
  const [landingError, setLandingError] = useState(false)
  const retrySync = useRef<() => void>(() => {})
  // apiRef gates the drag/drop handlers (nulled on detach); receivedApiRef
  // survives effect re-runs so setup can reattach to the same instance.
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const receivedApiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Press record for the armed click-to-place gesture; null while unarmed.
  const placeDownRef = useRef<(PlacementPointer & { surface: boolean }) | null>(null)
  const handleApi = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api
    receivedApiRef.current = api
  }, [])

  useEffect(() => {
    const api = receivedApiRef.current
    if (api === null) return
    const handle = attachStudioCanvas(api, {
      setSyncStatus,
      setLandingError,
      getContainer: () => containerRef.current,
      onDetach: () => { if (apiRef.current === api) apiRef.current = null },
    })
    retrySync.current = () => handle.retry()
    return () => {
      handle()
      retrySync.current = () => {}
    }
  }, [])

  const initialData = useCallback(async () => {
    const persisted = await loadPersistedCanvas()
    const theme = hostTheme()
    const appState = { theme, viewBackgroundColor: 'transparent', selectedElementIds: {} }
    if (persisted === null) return { appState }
    return { elements: persisted.elements, files: persisted.files, appState: { ...persisted.appState, ...appState } }
  }, [])

  const statusText = lang === 'en'
    ? syncStatus.phase === 'ready' ? `Selection ready · ${syncStatus.count} shapes`
      : syncStatus.phase === 'preparing' ? `Preparing selection · ${syncStatus.count} shapes…`
        : 'Selection sync failed'
    : syncStatus.phase === 'ready' ? `选区已就绪 · ${syncStatus.count} 个元素`
      : syncStatus.phase === 'preparing' ? `正在准备选区 · ${syncStatus.count} 个元素…`
        : '选区同步失败'

  return (
    <div className="dsh-ig-canvas-surface" ref={containerRef} onPointerDownCapture={event => {
      // Record the press only while armed; drags/pans pass through untouched
      // because nothing here prevents default or stops propagation.
      placeDownRef.current = placeItem == null ? null : {
        button: event.button,
        clientX: event.clientX,
        clientY: event.clientY,
        surface: isPlacementSurfaceTarget(event.target),
      }
    }} onPointerUpCapture={event => {
      const down = placeDownRef.current
      placeDownRef.current = null
      const api = apiRef.current
      placeArmedItemClick(api, containerRef.current, placeItem, down, {
        button: event.button,
        clientX: event.clientX,
        clientY: event.clientY,
        target: event.target,
      }, {
        onPlaced: () => onPlaced?.(),
        onUnreadable: () => setLandingError(true),
        isMounted: () => apiRef.current === api,
      })
    }} onDragOverCapture={event => {
      // Drag-over runs in protected mode: inspect types, not getData().
      // A cold internal drag has no Files payload for the editor's handler.
      if (!apiRef.current || !event.dataTransfer.types.includes(GALLERY_IMAGE_MIME)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
    }} onDropCapture={event => {
      const item = readGalleryImageDrop(event.dataTransfer)
      const api = apiRef.current
      if (!item || !api) return
      event.preventDefault()
      event.stopPropagation()
      setLandingError(false)
      const generation = getCanvasLandingGeneration()
      void landCanvasItems(api, [item], () => apiRef.current === api && generation === getCanvasLandingGeneration(), () => setLandingError(true))
        .catch(error => {
          if (apiRef.current === api) setLandingError(true)
          console.warn('[dsh-image-gen] history image drop failed:', error)
        })
    }}>
      <Excalidraw
        excalidrawAPI={handleApi}
        initialData={initialData}
        langCode={lang === 'zh' ? 'zh-CN' : 'en'}
        name="dsh-image-gen-workbench"
        gridModeEnabled={false}
        aiEnabled={false}
        validateEmbeddable={false}
        UIOptions={{
          canvasActions: {
            // The plugin owns the document lifecycle: persistence, clear and
            // theme come from the workbench, not the editor's file menu.
            loadScene: false,
            saveToActiveFile: false,
            clearCanvas: false,
            changeViewBackgroundColor: false,
            toggleTheme: false,
          },
        }}
      />
      {(landingError || syncStatus.phase !== 'idle') && (
        <div className="dsh-ig-canvas-sync-status" data-phase={landingError ? 'error' : syncStatus.phase} role="status" aria-live="polite">
          <span>{landingError
            ? lang === 'en' ? 'Could not read the original image. Reload it and try again.' : '无法读取原图，请重新加载图片后重试。'
            : <>{statusText}{syncStatus.phase === 'error' ? `：${canvasSyncError(syncStatus.error, lang)}` : ''}</>}</span>
          {!landingError && syncStatus.phase === 'error' && <button type="button" onClick={() => retrySync.current()}>{lang === 'en' ? 'Retry' : '重试'}</button>}
        </div>
      )}
      {placeItem != null && (
        <div className="dsh-ig-canvas-sync-status dsh-ig-canvas-place-hint" role="status" aria-live="polite">
          <span>{lang === 'en' ? 'Click the canvas to place · Esc cancels' : '点击画布放置图片 · Esc 取消'}</span>
        </div>
      )}
    </div>
  )
})

function canvasSyncError(error: string | undefined, lang: 'zh' | 'en'): string {
  const en = lang === 'en'
  if (error?.includes('too-many-selected')) return en ? 'Select at most 16 shapes to edit with originals.' : '使用原图编辑时，请一次选择不超过 16 个元素。'
  if (error?.includes('too-large')) return en ? 'An image exceeds the size limit. Reduce its size and retry.' : '图片超出大小限制，请缩小后重试。'
  if (error?.includes('unsupported')) return en ? 'Use PNG, JPEG, WebP or GIF images.' : '请使用 PNG、JPEG、WebP 或 GIF 图片。'
  if (error?.includes('host-unavailable')) return en ? 'Restart DSH to load the updated plugin, then retry.' : '请重启 DSH 加载新版插件后重试。'
  return en ? 'Check the connection or re-import an unavailable image, then retry.' : '请检查连接；若原图已失效，请重新导入后重试。'
}
