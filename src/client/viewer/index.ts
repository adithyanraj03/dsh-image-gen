/**
 * Viewer module entry: public exports + one-time registration.
 *
 * `registerViewer(ctx, t)` provides the `imageGenViewer` service, mounts the
 * standalone overlay in `shell.overlay`, injects the stage CSS, and builds the
 * annotated-PNG → composer-draft commit from optional sessions/conversation
 * injection. Surfaces read the shared service/commit via `getSharedViewer()`.
 */
import { ImageViewerService } from './viewer-service.js'
import { createDraftCommit, type Annotation, type CommitEntry, type ConversationLike, type SessionsLike } from './annotations.js'
import { noteText, ViewerOverlay, type ViewerT } from './image-lightbox.js'
import { VIEWER_CSS } from './styles.js'

export { ImageViewerService, normalizeViewerRequest } from './viewer-service.js'
export type { ViewerItem, ViewerAction, ViewerDownload, ViewerRequest } from './viewer-service.js'
export { renderAnnotationImage, createDraftCommit, currentSessionId } from './annotations.js'
export type { Annotation, CommitEntry, CommitItem } from './annotations.js'
export { ImageLightbox, ViewerOverlay, noteText, VIEWER_KEYS } from './image-lightbox.js'
export type { ViewerKey, ViewerT, ImageLightboxProps } from './image-lightbox.js'
export { useImageTransform } from './use-image-transform.js'
export { VIEWER_CSS } from './styles.js'

/** Structural view of the cordis Context pieces registration touches. */
interface ViewerCtx {
  effect(fn: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: { provide(name: string, value: unknown): (() => void) | void }
  slots: {
    inject(name: string, fn: () => unknown): unknown
    register(options: object, component: unknown): () => void
  }
  inject(services: string[], callback: (owner: ViewerCtx) => void): void
}

export interface SharedViewer {
  service: ImageViewerService
  commit(entries: CommitEntry[]): Promise<void>
}

let shared: SharedViewer | undefined

export function getSharedViewer(): SharedViewer | undefined { return shared }

async function fetchBlob(src: string): Promise<Blob> {
  const response = await fetch(src)
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`)
  return response.blob()
}

export function registerViewer(ctx: ViewerCtx, t: ViewerT, readBlob: (src: string) => Promise<Blob> = fetchBlob): SharedViewer {
  const service = new ImageViewerService()
  let sessions: SessionsLike | undefined
  let conversation: ConversationLike | undefined

  // Optional injection: a host without these services still gets the viewer;
  // only the draft commit degrades (annotations stay copyable).
  const inject = ctx.inject as unknown as (services: string[], callback: (owner: ViewerCtx) => void) => void
  inject.call(ctx, ['sessions', 'conversation'], owner => {
    sessions = owner.get('sessions') as SessionsLike | undefined
    conversation = owner.get('conversation') as ConversationLike | undefined
  })

  const commit = createDraftCommit({
    getSessions: () => sessions,
    getConversation: () => conversation,
    readBlob,
    formatNotes: (annotations: Annotation[]) => noteText(annotations, t),
  })

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-image-gen-viewer'
    style.textContent = VIEWER_CSS
    document.head.appendChild(style)
    const disposeService = ctx.reflect.provide('imageGenViewer', service)
    const register = ctx.slots.register.bind(ctx.slots)
    const disposeSlot = ctx.slots.inject('shell.overlay', () => register({
      name: 'shell.overlay', id: 'dsh-image-gen-viewer', order: 21, inject: () => ({ service, t }),
    }, ViewerOverlay)) as (() => void) | undefined
    return () => {
      style.remove()
      if (typeof disposeSlot === 'function') disposeSlot()
      if (typeof disposeService === 'function') disposeService()
    }
  }, 'dsh-image-gen: viewer service, overlay and styles')

  shared = { service, commit }
  return shared
}
