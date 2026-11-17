import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  EXCALIDRAW_CHROME_SELECTOR,
  PLACE_CLICK_SLOP_PX,
  clientToScenePoint,
  isPlainLeftClick,
  isPlacementSurfaceTarget,
} from '../src/client/canvas/canvas-placement.js'
import { StudioCanvas, landCanvasItems, placeArmedItemClick } from '../src/client/canvas/studio-canvas.js'
import { GalleryCanvasButton } from '../src/client/canvas/gallery-canvas-button.js'
import { RecentItem } from '../src/client/studio-helpers.js'
import { GALLERY_IMAGE_MIME, galleryLanding } from '../src/client/canvas/gallery-image-transfer.js'
import { fetchAttachmentBlob } from '../src/client/image-cache.js'
import { clearCanvasLandings, registerCanvasLandingConsumer, type CanvasLandingItem } from '../src/client/canvas/canvas-bridge.js'

// Same node-safe harness as gallery-canvas-ui.spec.ts: real component callbacks
// and the real landing adapter, mocked React/Excalidraw/host surfaces.
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  memo: (fn: unknown) => fn, useId: () => 'test-place', useCallback: (fn: unknown) => fn,
  useRef: (current: unknown) => ({ current }), useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}))
vi.mock('@excalidraw/excalidraw', () => ({ Excalidraw: () => null }))
vi.mock('../src/client/canvas/canvas-brand-theme.js', () => ({ syncCanvasThemeWithHost: () => vi.fn(), hostTheme: () => 'light', canvasExportBackground: () => '#e6ebf5' }))
vi.mock('../src/client/canvas/canvas-sync.js', () => ({ startCanvasSync: () => Object.assign(vi.fn(), { retry: vi.fn() }) }))
vi.mock('../src/client/image-cache.js', () => ({ fetchAttachmentBlob: vi.fn(), clearAttachmentCache: vi.fn() }))
vi.mock('../src/client/browser-image-utils.js', () => ({ blobToDataUrl: async () => 'data:image/png;base64,cG5n' }))

const galleryItem = { id: 'g-123', prompt: 'a cat', provider: 'google' as const, model: 'gemini', createdAt: 1,
  attachment: { attachmentId: 'sha256:cat', mediaType: 'image/png' as const, bytes: 3, width: 32, height: 24 } }
const landing: CanvasLandingItem = {
  galleryId: 'g-123', prompt: 'a cat', provider: 'google', model: 'gemini-image',
  attachment: { attachmentId: 'sha256:cat', mediaType: 'image/png', bytes: 3, width: 32, height: 24 },
}
// 32x24 original -> displaySizeOf caps the long side at 380 -> 380x285.
const DISPLAY = { w: 380, h: 285 }

const stops: Array<() => void> = []
beforeEach(() => vi.mocked(fetchAttachmentBlob).mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' })))
afterEach(() => { for (const stop of stops.splice(0).reverse()) stop(); clearCanvasLandings() })

function mockApi(camera: { scrollX?: number; scrollY?: number; zoom?: number } = {}) {
  const files = new Map<string, any>()
  let elements: any[] = []
  const api = {
    id: 'test',
    updateScene: vi.fn((scene: { elements?: any[]; appState?: unknown }) => { if (scene.elements) elements = [...scene.elements] }),
    getSceneElements: () => elements.filter(element => !element.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    getFiles: () => Object.fromEntries(files),
    addFiles: vi.fn((values: any[]) => { for (const file of values) if (!files.has(file.id)) files.set(file.id, file) }),
    getAppState: () => ({ scrollX: camera.scrollX ?? 0, scrollY: camera.scrollY ?? 0, zoom: { value: camera.zoom ?? 1 }, width: 1200, height: 800, selectedElementIds: {}, isLoading: false }),
    scrollToContent: vi.fn(),
    onChange: () => () => {},
    live: () => elements.filter(element => !element.isDeleted),
  }
  return api as typeof api & ExcalidrawImperativeAPI
}

const canvasTarget = { tagName: 'CANVAS', closest: () => null }
const chromeTarget = { tagName: 'BUTTON', closest: () => ({}) }
const fakeContainer = (left = 100, top = 50) => ({ getBoundingClientRect: () => ({ left, top }) })

function pointerEvent(overrides: Record<string, unknown> = {}) {
  return { button: 0, clientX: 300, clientY: 250, target: canvasTarget, ...overrides }
}

function downRecord(overrides: Record<string, unknown> = {}) {
  return { button: 0, clientX: 300, clientY: 250, surface: true, ...overrides }
}

function hooks() {
  return { onPlaced: vi.fn(), onUnreadable: vi.fn(), isMounted: () => true }
}

/** Render the real component with an armed item; refs are wired by hand the
 *  way React would attach them (the excalidrawAPI callback and the div ref).
 *  React 18 keeps the root ref on element.ref, not in props. */
function armedCanvas(placeItem: CanvasLandingItem | null, lang: 'zh' | 'en' = 'en') {
  const onPlaced = vi.fn()
  const component: any = (StudioCanvas as any)({ lang, placeItem, onPlaced })
  const api = mockApi()
  component.props.children[0].props.excalidrawAPI(api)
  const containerRef = component.props.ref ?? component.ref
  containerRef.current = fakeContainer()
  stops.push(() => component.props.children[0].props.excalidrawAPI(null))
  return { component, api, onPlaced }
}

describe('client → scene coordinate math', () => {
  it('maps a click through the container rect at zoom 1 with no scroll', () => {
    expect(clientToScenePoint({ clientX: 300, clientY: 250 }, { left: 100, top: 50 }, { scrollX: 0, scrollY: 0, zoom: 1 })).toEqual({ x: 200, y: 200 })
  })

  it('applies scroll and zoom exactly like the viewport model', () => {
    expect(clientToScenePoint({ clientX: 210, clientY: 120 }, { left: 10, top: 20 }, { scrollX: 120, scrollY: -40, zoom: 2 })).toEqual({ x: 40, y: 70 })
  })

  it('maps the container top-left to the viewport origin (-scroll/zoom)', () => {
    const camera = { scrollX: 240, scrollY: -80, zoom: 2 }
    expect(clientToScenePoint({ clientX: 100, clientY: 50 }, { left: 100, top: 50 }, camera)).toEqual({ x: -120, y: 40 })
  })

  it('scales correctly when zoomed out', () => {
    expect(clientToScenePoint({ clientX: 100, clientY: 80 }, { left: 0, top: 0 }, { scrollX: 0, scrollY: 0, zoom: 0.5 })).toEqual({ x: 200, y: 160 })
  })

  it.each([0, -1])('never divides by a non-positive zoom (%s)', zoom => {
    expect(clientToScenePoint({ clientX: 300, clientY: 250 }, { left: 100, top: 50 }, { scrollX: 0, scrollY: 0, zoom })).toEqual({ x: 200, y: 200 })
  })
})

describe('plain-click gesture guard', () => {
  it('accepts a motionless left click', () => {
    expect(isPlainLeftClick({ button: 0, clientX: 10, clientY: 10 }, { button: 0, clientX: 10, clientY: 10 })).toBe(true)
  })

  it('accepts jitter up to the slop threshold and rejects beyond it', () => {
    const down = { button: 0, clientX: 0, clientY: 0 }
    expect(isPlainLeftClick(down, { button: 0, clientX: PLACE_CLICK_SLOP_PX, clientY: 0 })).toBe(true)
    expect(isPlainLeftClick(down, { button: 0, clientX: PLACE_CLICK_SLOP_PX + 1, clientY: 0 })).toBe(false)
    // Diagonal movement counts too: (5,5) is ~7.07px away.
    expect(isPlainLeftClick(down, { button: 0, clientX: 5, clientY: 5 })).toBe(false)
  })

  it.each([1, 2])('rejects non-left buttons (%s)', button => {
    expect(isPlainLeftClick({ button, clientX: 0, clientY: 0 }, { button: 0, clientX: 0, clientY: 0 })).toBe(false)
    expect(isPlainLeftClick({ button: 0, clientX: 0, clientY: 0 }, { button, clientX: 0, clientY: 0 })).toBe(false)
  })

  it('rejects a release without a recorded press', () => {
    expect(isPlainLeftClick(null, { button: 0, clientX: 0, clientY: 0 })).toBe(false)
  })
})

describe('placement surface target', () => {
  it('accepts the interactive drawing canvas', () => {
    expect(isPlacementSurfaceTarget(canvasTarget)).toBe(true)
    expect(isPlacementSurfaceTarget({ tagName: 'CANVAS' })).toBe(true)
  })

  it('rejects a canvas nested inside UI chrome (defensive)', () => {
    expect(isPlacementSurfaceTarget({ tagName: 'CANVAS', closest: () => ({}) })).toBe(false)
  })

  it.each([
    ['toolbar button', chromeTarget],
    ['menu div', { tagName: 'DIV', closest: () => null }],
    ['svg icon', { tagName: 'svg', closest: () => null }],
    ['embeddable iframe', { tagName: 'IFRAME', closest: () => null }],
    ['text editor', { tagName: 'TEXTAREA', closest: () => null }],
  ])('rejects chrome element: %s', (_label, target) => {
    expect(isPlacementSurfaceTarget(target)).toBe(false)
  })

  it.each([null, undefined, 'canvas', 42])('rejects non-element target %s', target => {
    expect(isPlacementSurfaceTarget(target)).toBe(false)
  })

  it('names every Excalidraw chrome island in the selector', () => {
    for (const island of ['.layer-ui__wrapper', '.App-toolbar', '.dropdown-menu', '.context-menu', '.sidebar', '.popover', '.Modal']) {
      expect(EXCALIDRAW_CHROME_SELECTOR).toContain(island)
    }
  })
})

describe('anchored landing shares the landing code path', () => {
  it('centers one image on the anchor with the landing display size and provenance', async () => {
    const api = mockApi()
    expect(await landCanvasItems(api, [landing], () => true, undefined, { anchor: { x: 200, y: 200 } })).toBe(true)
    expect(api.live()).toHaveLength(1)
    expect(api.live()[0]).toMatchObject({
      type: 'image',
      x: Math.round(200 - DISPLAY.w / 2),
      y: Math.round(200 - DISPLAY.h / 2),
      width: DISPLAY.w,
      height: DISPLAY.h,
      customData: { galleryId: 'g-123', attachmentId: 'sha256:cat', prompt: 'a cat', provider: 'google', model: 'gemini-image', fromConversation: false, width: 32, height: 24 },
    })
  })

  it('keeps provenance byte-identical to a grid landing', async () => {
    const grid = mockApi()
    const anchored = mockApi()
    await landCanvasItems(grid, [landing], () => true)
    await landCanvasItems(anchored, [landing], () => true, undefined, { anchor: { x: 0, y: 0 } })
    expect(anchored.live()[0].customData).toEqual(grid.live()[0].customData)
    expect(anchored.live()[0].fileId).toBe(grid.live()[0].fileId)
  })

  it('honors the explicit point even when existing content occupies it', async () => {
    const api = mockApi()
    await landCanvasItems(api, [landing], () => true)
    const first = { ...api.live()[0] }
    await landCanvasItems(api, [{ ...landing, galleryId: 'g-456' }], () => true, undefined, { anchor: { x: 600, y: 400 } })
    expect(api.live()).toHaveLength(2)
    // Grid landing sits at the viewport center; the anchored image lands on
    // the very same spot instead of being pushed below the content.
    expect(api.live()[1]).toMatchObject({ x: first.x, y: first.y })
    expect(api.live()[0]).toMatchObject({ x: first.x, y: first.y })
  })

  it('never moves the camera for an anchored placement', async () => {
    const api = mockApi({ scrollX: 300, scrollY: -200, zoom: 2 })
    await landCanvasItems(api, [landing], () => true, undefined, { anchor: { x: 5000, y: 5000 } })
    expect(api.scrollToContent).not.toHaveBeenCalled()
    for (const [scene] of api.updateScene.mock.calls) expect(scene.appState).toBeUndefined()
  })

  it('dedupes repeated placements of the same gallery image', async () => {
    const api = mockApi()
    await landCanvasItems(api, [landing], () => true, undefined, { anchor: { x: 100, y: 100 } })
    expect(await landCanvasItems(api, [landing], () => true, undefined, { anchor: { x: 900, y: 900 } })).toBe(true)
    expect(api.live()).toHaveLength(1)
    expect(fetchAttachmentBlob).toHaveBeenCalledTimes(1)
  })

  it('allows re-placement after the user deletes the element', async () => {
    const api = mockApi()
    await landCanvasItems(api, [landing], () => true, undefined, { anchor: { x: 100, y: 100 } })
    api.getSceneElementsIncludingDeleted()[0].isDeleted = true
    await landCanvasItems(api, [landing], () => true, undefined, { anchor: { x: 300, y: 300 } })
    expect(api.live()).toHaveLength(1)
    expect(api.live()[0]).toMatchObject({ x: Math.round(300 - DISPLAY.w / 2), y: Math.round(300 - DISPLAY.h / 2) })
  })

  it('does not land when the canvas closes during the fetch', async () => {
    const api = mockApi()
    expect(await landCanvasItems(api, [landing], () => false, undefined, { anchor: { x: 100, y: 100 } })).toBe(false)
    expect(api.live()).toHaveLength(0)
    expect(fetchAttachmentBlob).not.toHaveBeenCalled()
  })
})

describe('placeArmedItemClick gesture driver', () => {
  it('commits a plain canvas click: disarms once and lands centered on the scene point', async () => {
    const api = mockApi()
    const h = hooks()
    expect(placeArmedItemClick(api, fakeContainer(), landing, downRecord(), pointerEvent(), h)).toBe(true)
    expect(h.onPlaced).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(api.live()).toHaveLength(1))
    // rect(100,50), zoom 1, no scroll: client(300,250) -> scene(200,200).
    expect(api.live()[0]).toMatchObject({ x: 200 - DISPLAY.w / 2, y: Math.round(200 - DISPLAY.h / 2), customData: { galleryId: 'g-123' } })
  })

  it('converts through a scrolled, zoomed camera', async () => {
    const api = mockApi({ scrollX: 100, scrollY: -40, zoom: 2 })
    const h = hooks()
    expect(placeArmedItemClick(api, fakeContainer(), landing, downRecord(), pointerEvent(), h)).toBe(true)
    await vi.waitFor(() => expect(api.live()).toHaveLength(1))
    // scene = ((300-100-100)/2, (250-50+40)/2) = (50, 120)
    expect(api.live()[0]).toMatchObject({ x: Math.round(50 - DISPLAY.w / 2), y: Math.round(120 - DISPLAY.h / 2) })
  })

  it('keeps the arm on a drag', async () => {
    const api = mockApi()
    const h = hooks()
    expect(placeArmedItemClick(api, fakeContainer(), landing, downRecord(), pointerEvent({ clientX: 340, clientY: 280 }), h)).toBe(false)
    expect(h.onPlaced).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(api.live()).toHaveLength(0)
  })

  it('keeps the arm on non-left buttons', async () => {
    const api = mockApi()
    const h = hooks()
    expect(placeArmedItemClick(api, fakeContainer(), landing, downRecord({ button: 2 }), pointerEvent({ button: 2 }), h)).toBe(false)
    expect(h.onPlaced).not.toHaveBeenCalled()
  })

  it('keeps the arm when the press or release sits on UI chrome', async () => {
    const api = mockApi()
    const h = hooks()
    expect(placeArmedItemClick(api, fakeContainer(), landing, downRecord({ surface: false }), pointerEvent(), h)).toBe(false)
    expect(placeArmedItemClick(api, fakeContainer(), landing, downRecord(), pointerEvent({ target: chromeTarget }), h)).toBe(false)
    expect(h.onPlaced).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(api.live()).toHaveLength(0)
  })

  it('does nothing without an api, container, item or press record', () => {
    const h = hooks()
    expect(placeArmedItemClick(null, fakeContainer(), landing, downRecord(), pointerEvent(), h)).toBe(false)
    expect(placeArmedItemClick(mockApi(), null, landing, downRecord(), pointerEvent(), h)).toBe(false)
    expect(placeArmedItemClick(mockApi(), fakeContainer(), null, downRecord(), pointerEvent(), h)).toBe(false)
    expect(placeArmedItemClick(mockApi(), fakeContainer(), landing, null, pointerEvent(), h)).toBe(false)
    expect(h.onPlaced).not.toHaveBeenCalled()
  })

  it('does not finish the landing if the canvas detaches mid-fetch', async () => {
    const api = mockApi()
    let finish!: (blob: Blob) => void
    vi.mocked(fetchAttachmentBlob).mockReturnValue(new Promise(resolve => { finish = resolve }))
    let mounted = true
    const h = { onPlaced: vi.fn(), onUnreadable: vi.fn(), isMounted: () => mounted }
    expect(placeArmedItemClick(api, fakeContainer(), landing, downRecord(), pointerEvent(), h)).toBe(true)
    mounted = false
    finish(new Blob(['png'], { type: 'image/png' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(api.live()).toHaveLength(0)
  })
})

describe('StudioCanvas click-to-place wiring', () => {
  it('shows the armed hint pill in both languages and hides it when unarmed', () => {
    const en = armedCanvas(landing, 'en')
    const hint = en.component.props.children.find((child: any) => child?.props?.className?.includes('dsh-ig-canvas-place-hint'))
    expect(hint.props.children.props.children).toBe('Click the canvas to place · Esc cancels')
    const zh = armedCanvas(landing, 'zh')
    const zhHint = zh.component.props.children.find((child: any) => child?.props?.className?.includes('dsh-ig-canvas-place-hint'))
    expect(zhHint.props.children.props.children).toBe('点击画布放置图片 · Esc 取消')
    const unarmed = armedCanvas(null)
    expect(unarmed.component.props.children.some((child: any) => child?.props?.className?.includes('dsh-ig-canvas-place-hint'))).toBe(false)
  })

  it('arm → click → place → disarm through the real component handlers', async () => {
    const c = armedCanvas(landing)
    c.component.props.onPointerDownCapture(pointerEvent())
    c.component.props.onPointerUpCapture(pointerEvent())
    expect(c.onPlaced).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(c.api.live()).toHaveLength(1))
    expect(c.api.live()[0]).toMatchObject({ x: 10, y: 58, width: DISPLAY.w, height: DISPLAY.h, customData: { galleryId: 'g-123', prompt: 'a cat' } })
    // Re-render after disarm: the hint is gone.
    const after: any = (StudioCanvas as any)({ lang: 'en', placeItem: null, onPlaced: c.onPlaced })
    expect(after.props.children.some((child: any) => child?.props?.className?.includes('dsh-ig-canvas-place-hint'))).toBe(false)
  })

  it('ignores drags, right clicks and chrome clicks without consuming the arm', async () => {
    const c = armedCanvas(landing)
    c.component.props.onPointerDownCapture(pointerEvent())
    c.component.props.onPointerUpCapture(pointerEvent({ clientX: 380, clientY: 300 }))
    c.component.props.onPointerDownCapture(pointerEvent({ button: 2 }))
    c.component.props.onPointerUpCapture(pointerEvent({ button: 2 }))
    c.component.props.onPointerDownCapture(pointerEvent({ target: chromeTarget }))
    c.component.props.onPointerUpCapture(pointerEvent({ target: chromeTarget }))
    expect(c.onPlaced).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(c.api.live()).toHaveLength(0)
    // The arm survives: a following plain click still places.
    c.component.props.onPointerDownCapture(pointerEvent())
    c.component.props.onPointerUpCapture(pointerEvent())
    expect(c.onPlaced).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(c.api.live()).toHaveLength(1))
  })

  it('plain clicks do nothing while unarmed', async () => {
    const c = armedCanvas(null)
    c.component.props.onPointerDownCapture(pointerEvent())
    c.component.props.onPointerUpCapture(pointerEvent())
    expect(c.onPlaced).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(c.api.live()).toHaveLength(0)
  })

  it('does not place after the canvas detaches', async () => {
    const c = armedCanvas(landing)
    stops.pop()!()
    c.component.props.onPointerDownCapture(pointerEvent())
    c.component.props.onPointerUpCapture(pointerEvent())
    expect(c.onPlaced).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(c.api.live()).toHaveLength(0)
  })

  it('drag-and-drop keeps working unchanged while an item is armed', async () => {
    const c = armedCanvas(landing)
    const event = { dataTransfer: { getData: (type: string) => type === GALLERY_IMAGE_MIME ? JSON.stringify({ galleryId: galleryItem.id, ...galleryItem }) : '' }, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    c.component.props.onDropCapture(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(c.api.live()).toHaveLength(1))
    // Drop uses the grid path (viewport center), not the click anchor, and
    // does not consume the armed item.
    expect(c.api.live()[0]).toMatchObject({ x: 410, y: 258 })
    expect(c.onPlaced).not.toHaveBeenCalled()
  })
})

describe('rail place affordance arms instead of sending', () => {
  it('arms click-to-place without queueing a landing', async () => {
    const consumer = vi.fn(async () => true)
    stops.push(registerCanvasLandingConsumer(consumer))
    const onArm = vi.fn()
    const onToast = vi.fn()
    const button: any = GalleryCanvasButton({ item: galleryItem, lang: 'zh', onToast, onArm })
    expect(button.props.disabled).toBeFalsy()
    expect(button.props.title).toBe('放置到画布（点击定位）')
    const stopPropagation = vi.fn()
    button.props.onClick({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onArm).toHaveBeenCalledWith(galleryItem)
    expect(onToast).toHaveBeenCalledWith('点击画布放置图片')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(consumer).not.toHaveBeenCalled()
  })

  it('keeps the immediate-send behavior without an arm handler', async () => {
    const consumer = vi.fn(async () => true)
    stops.push(registerCanvasLandingConsumer(consumer))
    const button: any = GalleryCanvasButton({ item: galleryItem, lang: 'en', onToast: vi.fn() })
    expect(button.props.title).toBe('Send to canvas')
    button.props.onClick({ stopPropagation: vi.fn() })
    await vi.waitFor(() => expect(consumer).toHaveBeenCalledOnce())
    expect(consumer.mock.calls[0][0][0]).toMatchObject({ galleryId: 'g-123', onlyWhileCanvasOpen: true })
  })

  it('passes the arm handler through RecentItem only in place mode', () => {
    const place = vi.fn()
    const actions = { select: vi.fn(), favorite: vi.fn(), toast: vi.fn(), place }
    const armed: any = (RecentItem as any)({ item: galleryItem, active: false, mode: 'select', lang: 'zh', actions, placeMode: true })
    expect(armed.props.children[1].props.onArm).toBe(place)
    const plain: any = (RecentItem as any)({ item: galleryItem, active: false, mode: 'select', lang: 'zh', actions, placeMode: false })
    expect(plain.props.children[1].props.onArm).toBeUndefined()
    const legacy: any = (RecentItem as any)({ item: galleryItem, active: false, mode: 'select', lang: 'zh', actions: { select: vi.fn(), favorite: vi.fn(), toast: vi.fn() } })
    expect(legacy.props.children[1].props.onArm).toBeUndefined()
  })

  it('arms with the same landing mapping drag-and-drop uses', () => {
    expect(galleryLanding(galleryItem)).toEqual({
      galleryId: 'g-123',
      attachment: galleryItem.attachment,
      prompt: 'a cat',
      provider: 'google',
      model: 'gemini',
    })
  })
})
