import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { landCanvasItems } from '../src/client/canvas/studio-canvas.js'
import { fetchAttachmentBlob } from '../src/client/image-cache.js'
import type { CanvasLandingItem } from '../src/client/canvas/canvas-bridge.js'

// The component module imports the Excalidraw React surface; node has no DOM,
// so mock the package while exercising the real landing adapter.
vi.mock('@excalidraw/excalidraw', () => ({ Excalidraw: () => null }))
vi.mock('../src/client/image-cache.js', () => ({ fetchAttachmentBlob: vi.fn(), clearAttachmentCache: vi.fn() }))
vi.mock('../src/client/browser-image-utils.js', () => ({ blobToDataUrl: async (blob: Blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}` }))

const image: CanvasLandingItem = {
  galleryId: 'g-123', prompt: 'a cat', provider: 'google', model: 'gemini-image',
  attachment: { attachmentId: 'sha256:cat', mediaType: 'image/png', bytes: 3, width: 32, height: 24 },
}

function canvas() {
  const files = new Map<string, any>()
  let elements: any[] = []
  const api = {
    id: 'test',
    getSceneElements: () => elements.filter(element => !element.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    getFiles: () => Object.fromEntries(files),
    addFiles: vi.fn((values: any[]) => { for (const file of values) if (!files.has(file.id)) files.set(file.id, file) }),
    updateScene: vi.fn((scene: { elements?: any[] }) => { if (scene.elements) elements = [...scene.elements] }),
    getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 1200, height: 800, selectedElementIds: {} }),
    scrollToContent: vi.fn(),
  }
  return { api: api as unknown as ExcalidrawImperativeAPI, elements: () => elements, live: () => elements.filter(element => !element.isDeleted), files }
}

beforeEach(() => vi.mocked(fetchAttachmentBlob).mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' })))
afterEach(() => vi.restoreAllMocks())

describe('history images landing in the persistent canvas', () => {
  it('creates an image with the original data and generation provenance', async () => {
    const c = canvas()
    expect(await landCanvasItems(c.api, [image], () => true)).toBe(true)
    expect(c.live()).toHaveLength(1)
    expect(c.live()[0]).toMatchObject({
      type: 'image',
      customData: { galleryId: image.galleryId, attachmentId: 'sha256:cat', prompt: 'a cat', provider: 'google', model: 'gemini-image', fromConversation: false, width: 32, height: 24 },
    })
    expect([...c.files.values()][0].dataURL).toBe('data:image/png;base64,cG5n')
  })

  it('deduplicates repeated drops and clicks, including images moved elsewhere on the canvas', async () => {
    const c = canvas()
    await landCanvasItems(c.api, [image], () => true)
    c.live()[0].x = 5000
    c.live()[0].y = 5000
    await landCanvasItems(c.api, [image], () => true)
    expect(c.live()).toHaveLength(1)
    expect(fetchAttachmentBlob).toHaveBeenCalledTimes(1)
  })

  it('deduplicates simultaneous drops of the same image after the fetch completes', async () => {
    const c = canvas()
    await Promise.all(Array.from({ length: 10 }, () => landCanvasItems(c.api, [image], () => true)))
    expect(c.live()).toHaveLength(1)
    expect(c.files.size).toBe(1)
  })

  it('puts later images below occupied space instead of covering earlier ones', async () => {
    const c = canvas()
    await landCanvasItems(c.api, [image], () => true)
    await landCanvasItems(c.api, [{ ...image, galleryId: 'g-456' }], () => true)
    expect(c.live()).toHaveLength(2)
    expect(c.live()[1].y).toBeGreaterThanOrEqual(c.live()[0].y + c.live()[0].height + 40)
  })

  it('does not add files or elements if the canvas closes or is cleared during loading', async () => {
    const c = canvas()
    let finish!: (blob: Blob) => void
    vi.mocked(fetchAttachmentBlob).mockReturnValue(new Promise(resolve => { finish = resolve }))
    let active = true
    const pending = landCanvasItems(c.api, [image], () => active)
    active = false
    finish(new Blob(['png'], { type: 'image/png' }))
    expect(await pending).toBe(false)
    expect(c.live()).toHaveLength(0)
    expect(c.files.size).toBe(0)
  })

  it('does not fetch an image for an already closed canvas', async () => {
    const c = canvas()
    expect(await landCanvasItems(c.api, [image], () => false)).toBe(false)
    expect(fetchAttachmentBlob).not.toHaveBeenCalled()
  })

  it('does not leave a broken element behind when the original is no longer readable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fetchAttachmentBlob).mockRejectedValue(new Error('404'))
    const c = canvas()
    const onUnreadable = vi.fn()
    await landCanvasItems(c.api, [image], () => true, onUnreadable)
    expect(onUnreadable).toHaveBeenCalledOnce()
    expect(c.live()).toHaveLength(0)
    expect(c.files.size).toBe(0)
    // Retrying after the original becomes available succeeds.
    vi.mocked(fetchAttachmentBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    await landCanvasItems(c.api, [image], () => true)
    expect(c.live()).toHaveLength(1)
  })

  it('allows re-importing after the user deliberately deletes the existing element', async () => {
    const c = canvas()
    await landCanvasItems(c.api, [image], () => true)
    // Excalidraw keeps deleted elements in the scene for undo; the landing
    // dedupe only considers the live document.
    c.elements()[0].isDeleted = true
    await landCanvasItems(c.api, [image], () => true)
    expect(c.live()).toHaveLength(1)
    expect(c.files.size).toBe(1)
    expect(fetchAttachmentBlob).toHaveBeenCalledTimes(1)
  })
})
