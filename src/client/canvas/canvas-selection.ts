import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { CANVAS_ASSET_ROUTE } from '../../shared.js'
import { blobToDataUrl } from '../browser-image-utils.js'
import { boundsOfElements, withBoundAndFrameElements } from './canvas-summary.js'
import { canvasExportBackground, hostTheme } from './canvas-brand-theme.js'

/** Minimal face of Excalidraw's exportToBlob (its published types resolve
 *  through an unbundled workspace package, so pin the shape we rely on). */
type ExportToBlob = (opts: {
  elements: readonly ExcalidrawElement[]
  appState?: Partial<AppState>
  files: BinaryFiles | null
  mimeType?: string
  quality?: number
  exportPadding?: number
  getDimensions?: (width: number, height: number) => { width: number; height: number; scale?: number }
}) => Promise<Blob>

/** Bound raster dimensions before exporting; large multi-image PNGs get a
 *  JPEG preview instead of being silently discarded. Originals are separate. */
export async function exportSelectionPreview(api: ExcalidrawImperativeAPI, shapes: readonly ExcalidrawElement[], maxBytes: number, signal: AbortSignal): Promise<string> {
  const exportElements = withBoundAndFrameElements(shapes, api.getSceneElements())
  const bounds = boundsOfElements(exportElements)
  const scale = Math.min(1, 2048 / Math.max(1, bounds.w + 32, bounds.h + 32))
  const attempts = [
    { format: 'png' as const, scale, quality: 1 },
    { format: 'jpeg' as const, scale, quality: 0.85 },
    { format: 'jpeg' as const, scale: scale * 0.75, quality: 0.7 },
    { format: 'jpeg' as const, scale: scale * 0.5, quality: 0.6 },
    { format: 'jpeg' as const, scale: scale * 0.25, quality: 0.5 },
  ]
  // Stay below both the host limit and a modest browser/network budget.
  const maxChars = Math.floor(Math.min(maxBytes, 4_000_000) / 3) * 4
  const theme = hostTheme()
  const appState: Partial<AppState> = {
    exportBackground: true,
    // Solid theme background for exports even though the live editor canvas
    // is transparent (the dot grid lives in CSS behind it).
    viewBackgroundColor: canvasExportBackground(theme),
    exportWithDarkMode: theme === 'dark',
    exportScale: 1,
  }
  const { exportToBlob } = await import('@excalidraw/excalidraw') as unknown as { exportToBlob: ExportToBlob }
  for (const attempt of attempts) {
    signal.throwIfAborted()
    const blob = await exportToBlob({
      elements: exportElements,
      appState,
      files: api.getFiles(),
      mimeType: attempt.format === 'png' ? 'image/png' : 'image/jpeg',
      // Excalidraw warns when quality is passed for PNG; it only applies to JPEG.
      ...(attempt.format === 'jpeg' ? { quality: attempt.quality } : {}),
      exportPadding: 16,
      getDimensions: (width, height) => ({
        width: Math.max(1, Math.round(width * attempt.scale)),
        height: Math.max(1, Math.round(height * attempt.scale)),
        scale: attempt.scale,
      }),
    })
    signal.throwIfAborted()
    const url = await blobToDataUrl(blob)
    if (url.length - url.indexOf(',') - 1 <= maxChars) return url
  }
  throw new Error('preview-too-large')
}

export async function readCanvasImageLimit(signal: AbortSignal): Promise<number> {
  const response = await fetch(CANVAS_ASSET_ROUTE, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`host-unavailable (${response.status})`)
  const value = await response.json() as { maxImageBytes?: unknown }
  if (typeof value.maxImageBytes !== 'number' || !Number.isSafeInteger(value.maxImageBytes) || value.maxImageBytes <= 0) throw new Error('host-unavailable')
  return value.maxImageBytes
}

export interface CanvasOriginalCacheEntry { src: string | null; attachment: ImageAttachmentRef }

/** Read the original bytes straight from Excalidraw's files map (dataURL).
 *  Upload each original once per mount/source, with individual byte limits. */
export async function syncCanvasOriginal(api: ExcalidrawImperativeAPI, element: ExcalidrawElement, maxBytes: number, signal: AbortSignal, cache: Map<string, CanvasOriginalCacheEntry>): Promise<ImageAttachmentRef> {
  if (element.type !== 'image' || element.fileId === null) throw new Error('original-unavailable')
  const file = api.getFiles()[element.fileId]
  if (file === undefined) throw new Error('original-unavailable')
  const cached = cache.get(file.id)
  if (cached !== undefined && cached.src === file.dataURL) return cached.attachment
  const response = await fetch(file.dataURL, { signal })
  if (!response.ok) throw new Error('original-unavailable')
  const blob = await response.blob()
  if (blob.size > maxBytes) throw new Error('original-too-large')
  const mediaType = blob.type || file.mimeType || ''
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) throw new Error('original-format-unsupported')
  const uploaded = await fetch(CANVAS_ASSET_ROUTE, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': mediaType }, body: blob, signal,
  })
  if (!uploaded.ok) throw new Error(uploaded.status === 413 ? 'original-too-large' : `original-upload-failed (${uploaded.status})`)
  const result = await uploaded.json() as { attachment?: ImageAttachmentRef }
  const ref = result.attachment
  if (!ref || typeof ref.attachmentId !== 'string' || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(ref.mediaType)
    || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0 || !Number.isInteger(ref.width) || ref.width <= 0 || !Number.isInteger(ref.height) || ref.height <= 0) throw new Error('original-upload-failed')
  cache.set(file.id, { src: file.dataURL, attachment: ref })
  return ref
}
