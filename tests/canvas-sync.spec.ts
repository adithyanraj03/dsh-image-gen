import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { startCanvasSync } from '../src/client/canvas/canvas-sync.js'
import { CANVAS_STATE_ROUTE } from '../src/shared.js'

// The adapter's export path goes through Excalidraw's exportToBlob; mock the
// package (no DOM in node) while keeping the real sync/selection logic.
vi.mock('@excalidraw/excalidraw', () => ({ exportToBlob: vi.fn() }))
vi.mock('../src/client/browser-image-utils.js', () => ({
  blobToDataUrl: async (blob: Blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`,
}))

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

async function fixture(count: number) {
  const { exportToBlob } = await import('@excalidraw/excalidraw')
  // First attempt (PNG) busts the byte budget; the JPEG fallback fits.
  const oversizedPng = new Blob([new Uint8Array(4_200_000)], { type: 'image/png' })
  const compactJpeg = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
  vi.mocked(exportToBlob).mockResolvedValueOnce(oversizedPng).mockResolvedValue(compactJpeg)

  const elements = Array.from({ length: count }, (_, n) => ({
    id: `element-${n}`, type: 'image', x: n * 100, y: 0, width: 1024, height: 1024,
    version: 1, isDeleted: false, fileId: `file-${n}`, customData: {},
  }))
  const files = Object.fromEntries(elements.map((element, n) => [element.fileId, {
    id: element.fileId, mimeType: 'image/png', dataURL: `data:image/png;base64,AA${n}=`, created: 1,
  }]))
  const appState = { selectedElementIds: Object.fromEntries(elements.map(element => [element.id, true])) }
  let listener: (elements: unknown, appState: unknown, files: unknown) => void = () => {}
  const api = {
    id: 'editor-test',
    getSceneElements: () => elements,
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => appState,
    getFiles: () => files,
    onChange: (fn: typeof listener) => { listener = fn; return () => {} },
  }
  const pushes: any[] = []
  let uploads = 0
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('data:')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
    if (url === CANVAS_STATE_ROUTE) {
      pushes.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true })
    }
    if (!init?.method || init.method === 'GET') return Response.json({ maxImageBytes: 5_000_000 })
    uploads++
    return Response.json({ attachment: { attachmentId: `sha256:${uploads}`, mediaType: 'image/png', bytes: 3, width: 1024, height: 1024 } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    api: api as unknown as ExcalidrawImperativeAPI, exportToBlob: vi.mocked(exportToBlob), pushes, fetchMock,
    change: () => listener(elements.map(element => ({ ...element, version: element.version + 1 })), appState, files),
    changeNothing: () => listener(elements, appState, files),
  }
}

describe('canvas selection sync', () => {
  it.each([2, 4])('keeps a usable preview when %i selected images exceed the PNG budget', async count => {
    vi.useFakeTimers()
    const f = await fixture(count)
    const stop = startCanvasSync(f.api)
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.pushes.some(push => push.selectionImage === 'data:image/jpeg;base64,AQID')).toBe(true)
    expect(f.exportToBlob.mock.calls.length).toBeGreaterThan(1)
    stop()
  })

  it('sends all four originals as durable references, independent of conversation history', async () => {
    vi.useFakeTimers()
    const f = await fixture(4)
    const stop = startCanvasSync(f.api)
    await vi.advanceTimersByTimeAsync(2000)
    const ready = f.pushes.findLast(p => p.selectionStatus === 'ready')
    expect(ready?.selection.items.map((item: any) => item.attachment?.attachmentId)).toEqual(['sha256:1', 'sha256:2', 'sha256:3', 'sha256:4'])
    stop()
  })

  it('never pushes an unchanged snapshot twice', async () => {
    vi.useFakeTimers()
    const f = await fixture(2)
    const stop = startCanvasSync(f.api)
    await vi.advanceTimersByTimeAsync(2000)
    const settled = f.pushes.length
    f.changeNothing()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.pushes.length).toBe(settled)
    stop()
  })

  it('marks the instance offline on dispose', async () => {
    vi.useFakeTimers()
    const f = await fixture(1)
    const stop = startCanvasSync(f.api)
    await vi.advanceTimersByTimeAsync(2000)
    stop()
    await vi.advanceTimersByTimeAsync(10)
    const last = f.pushes.at(-1)
    expect(last.connected).toBe(false)
    expect(last.nodeCount).toBe(0)
  })
})
