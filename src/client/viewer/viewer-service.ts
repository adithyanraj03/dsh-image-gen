/**
 * Public viewer service: any card can call `imageGenViewer.open({...})`.
 *
 * Ported from dsh-image-viewer@0.1.20 (WSL043, MIT) src/viewer.js. The service
 * is a tiny external store (subscribe/getSnapshot) the overlay reads with
 * useSyncExternalStore; annotations persist per image id for the page lifetime.
 */
import type { Annotation, CommitEntry } from './annotations.js'

export interface ViewerDownload {
  pendingLabel?: string
  errorLabel?: string
  onInvoke(input: { item: ViewerItem; src: string; signal: AbortSignal; onProgress(v: { loaded: number; total?: number }): void }): Promise<void>
}
export interface ViewerAction {
  id: string
  label: string
  pendingLabel?: string
  errorLabel?: string
  closeOnSuccess?: boolean
  onInvoke(input: { annotations: Annotation[]; item: ViewerItem; src: string }): Promise<void> | void
}
export interface ViewerItem {
  id: string
  src: string
  name: string
  width?: number | undefined
  height?: number | undefined
  bytes?: number | undefined
  prompt?: string | undefined
  fallbackSrc?: string | undefined
  readBlob?(): Promise<Blob>
  download?: ViewerDownload | undefined
  actions?: ViewerAction[] | undefined
}
/** Where a preview was opened from: the composer draft rail or a message. */
export type ViewerOrigin = 'composer' | 'message'
export interface ViewerRequest {
  items: ViewerItem[]
  index: number
  opener?: HTMLElement | undefined
  source: string
  annotations: boolean
  commitAnnotations?: ((entries: CommitEntry[]) => Promise<void>) | undefined
  /** Composer-origin previews replace the originating draft attachment on save. */
  origin?: ViewerOrigin | undefined
  revision: number
  committing?: boolean | undefined
  commitError?: boolean | undefined
}

const boundedNumber = (value: unknown, fallback: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

export function normalizeViewerRequest(request: Partial<ViewerRequest> | undefined): ViewerRequest | undefined {
  const rawItems = Array.isArray(request?.items) ? request!.items! : []
  const items: ViewerItem[] = rawItems.flatMap((item, position) => {
    if (typeof item?.src !== 'string' || item.src === '') return []
    return [{
      id: typeof item.id === 'string' && item.id !== '' ? item.id : item.src,
      src: item.src,
      name: typeof item.name === 'string' && item.name !== '' ? item.name : `Image ${position + 1}`,
      width: boundedNumber(item.width, undefined),
      height: boundedNumber(item.height, undefined),
      bytes: boundedNumber(item.bytes, undefined),
      ...(item.prompt !== undefined ? { prompt: item.prompt } : {}),
      ...(item.fallbackSrc !== undefined ? { fallbackSrc: item.fallbackSrc } : {}),
      ...(item.readBlob !== undefined ? { readBlob: item.readBlob } : {}),
      ...(item.download !== undefined ? { download: item.download } : {}),
      actions: Array.isArray(item.actions) ? item.actions : [],
    }]
  })
  if (items.length === 0) return undefined
  const requestedIndex = Number.isInteger(request?.index) ? request!.index! : 0
  return {
    items,
    index: Math.max(0, Math.min(items.length - 1, requestedIndex)),
    opener: typeof HTMLElement !== 'undefined' && request?.opener instanceof HTMLElement ? request.opener : undefined,
    source: typeof request?.source === 'string' ? request.source : 'dsh-image-gen',
    annotations: request?.annotations !== false,
    commitAnnotations: typeof request?.commitAnnotations === 'function' ? request.commitAnnotations : undefined,
    ...(request?.origin === 'composer' || request?.origin === 'message' ? { origin: request.origin } : {}),
    revision: 0,
  }
}

export class ImageViewerService {
  #listeners = new Set<() => void>()
  #revision = 0
  #snapshot: ViewerRequest | undefined
  #annotationsByImage = new Map<string, Annotation[]>()
  #openingAnnotations = new Map<string, string>()
  #closing = false

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
  getSnapshot = (): ViewerRequest | undefined => this.#snapshot
  getAnnotationsSnapshot = (): Record<string, Annotation[]> => Object.fromEntries(
    [...this.#annotationsByImage].map(([id, annotations]) => [id, annotations.map(annotation => ({ ...annotation }))]),
  )

  setAnnotations(imageId: string, annotations: Annotation[]): void {
    if (typeof imageId !== 'string' || imageId === '' || !Array.isArray(annotations)) return
    if (annotations.length === 0) this.#annotationsByImage.delete(imageId)
    else this.#annotationsByImage.set(imageId, annotations.map(annotation => ({ ...annotation })))
  }
  getAnnotations(imageId: string): Annotation[] {
    return (this.#annotationsByImage.get(imageId) ?? []).map(annotation => ({ ...annotation }))
  }

  open(request: Partial<ViewerRequest>): boolean {
    if (this.#closing) return false
    const normalized = normalizeViewerRequest(request)
    if (normalized === undefined) return false
    this.#revision += 1
    this.#snapshot = { ...normalized, revision: this.#revision }
    this.#openingAnnotations = new Map(normalized.items.map(item => [item.id, JSON.stringify(this.#annotationsByImage.get(item.id) || [])]))
    this.#emit()
    return true
  }

  async close({ discard = false }: { discard?: boolean } = {}): Promise<boolean> {
    if (this.#snapshot === undefined) return true
    if (this.#closing) return false
    // Only images whose notes changed since opening are committed; the opening
    // snapshot is keyed by image id, so dedupe and unchanged notes are skipped.
    const snapshot = this.#snapshot
    const commit = snapshot.commitAnnotations
    const changed: CommitEntry[] = snapshot.items
      .map(item => ({ item: { src: item.src, name: item.name }, annotations: this.#annotationsByImage.get(item.id) || [], id: item.id }))
      .filter(({ annotations, id }) => annotations.some(note => note.note.trim()) && JSON.stringify(annotations) !== this.#openingAnnotations.get(id))
      .map(({ item, annotations }) => ({ item, annotations }))
    if (!discard && changed.length && commit) {
      this.#closing = true
      this.#snapshot = { ...snapshot, committing: true, commitError: false }
      this.#emit()
      try { await commit(changed) }
      catch {
        this.#snapshot = { ...this.#snapshot, committing: false, commitError: true }
        this.#closing = false
        this.#emit()
        return false
      }
      this.#closing = false
    }
    const opener = this.#snapshot.opener
    this.#snapshot = undefined
    this.#emit()
    if (typeof window === 'undefined') opener?.focus()
    else window.requestAnimationFrame(() => opener?.focus())
    return true
  }

  #emit(): void { for (const listener of this.#listeners) listener() }
}
