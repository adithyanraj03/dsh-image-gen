/**
 * Viewer module entry: public exports + one-time registration.
 *
 * `registerViewer(ctx, t)` provides the `imageGenViewer` service, mounts the
 * standalone overlay in `shell.overlay`, injects the stage CSS, and builds the
 * annotated-PNG → composer-draft commit from optional sessions/conversation
 * injection. Surfaces read the shared service/commit via `getSharedViewer()`.
 */
import { ImageViewerService } from './viewer-service.js'
import { captureDraftHost, commitDraftFiles, commitDraftFilesReplacing, createDraftCommit, type Annotation, type CommitEntry, type ConversationLike, type SessionsLike } from './annotations.js'
import { markedFileName, type MarkupCommitEntry, type MarkupCommitOutcome } from './markup.js'
import { noteText, ViewerOverlay, type ViewerT } from './image-lightbox.js'
import { installImageClickBridge } from './composer-bridge.js'
import { VIEWER_CSS } from './styles.js'

export { ImageViewerService, normalizeViewerRequest } from './viewer-service.js'
export type { ViewerItem, ViewerAction, ViewerDownload, ViewerRequest, ViewerOrigin } from './viewer-service.js'
export { renderAnnotationImage, createDraftCommit, currentSessionId, captureDraftHost, commitDraftFiles, commitDraftFilesReplacing, matchDraftAttachment, draftHostReady } from './annotations.js'
export type { Annotation, CommitEntry, CommitItem, DraftFile, DraftCommitHost, DraftAttachmentLike, DraftReplaceOutcome } from './annotations.js'
export { nativeImageButton, imageItemsForButton, installImageClickBridge } from './composer-bridge.js'
export type { BridgeNode, BridgeImageNode, ImageMatch, ImageBridgeDeps } from './composer-bridge.js'
export { ImageLightbox, ViewerOverlay, noteText, VIEWER_KEYS } from './image-lightbox.js'
export type { ViewerKey, ViewerT, ImageLightboxProps } from './image-lightbox.js'
export { useImageTransform } from './use-image-transform.js'
export { VIEWER_CSS } from './styles.js'
export {
  MARKUP_COLORS, MARKUP_STROKES, REDACT_OPACITY, arrowHeadPoints, buildMarkupOps, drawMarkupOps,
  imageScreenRect, markedFileName, nextStepNumber, normalizedToScreen, renderMarkupImage,
  screenToNormalized, stepContrast, stepRadius, strokePixels, textFontSize,
} from './markup.js'
export type { MarkupCommitEntry, MarkupCommitOutcome, MarkupDrawOp, MarkupGeometry, MarkupPoint, MarkupShape, MarkupStroke, MarkupTool, MarkupTransform, ScreenRect } from './markup.js'

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
  /** Attach baked marked PNGs to the pinned session's composer draft (no send). */
  commitMarkup(entries: MarkupCommitEntry[]): Promise<MarkupCommitOutcome>
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

  const hostDeps = { getSessions: () => sessions, getConversation: () => conversation }
  const commit = createDraftCommit({
    ...hostDeps,
    readBlob,
    formatNotes: (annotations: Annotation[]) => noteText(annotations, t),
  })
  // Markup save reuses the same session-pinned draft machinery: the lightbox
  // bakes the PNG, this attaches it as `<base>-marked.png` without sending.
  const markupHost = captureDraftHost(hostDeps)
  const commitMarkup = async (entries: MarkupCommitEntry[]): Promise<MarkupCommitOutcome> => {
    // Composer-origin save replaces the originating draft attachment by src;
    // every other surface keeps the existing add-alongside batch behavior.
    const replaceEntry = entries.find(entry => entry.replace === true)
    if (replaceEntry !== undefined) {
      const name = markedFileName(replaceEntry.item.name)
      const outcome = await commitDraftFilesReplacing(markupHost, replaceEntry.item.src, [
        { file: new File([replaceEntry.blob], name, { type: 'image/png' }), text: name },
      ])
      return outcome === 'replaced' ? 'replaced' : 'fallback'
    }
    await commitDraftFiles(markupHost, entries.map(({ item, blob }) => {
      const name = markedFileName(item.name)
      return { file: new File([blob], name, { type: 'image/png' }), text: name }
    }))
    return 'added'
  }

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-image-gen-viewer'
    style.textContent = VIEWER_CSS
    document.head.appendChild(style)
    const disposeService = ctx.reflect.provide('imageGenViewer', service)
    const register = ctx.slots.register.bind(ctx.slots)
    const disposeSlot = ctx.slots.inject('shell.overlay', () => register({
      name: 'shell.overlay', id: 'dsh-image-gen-viewer', order: 21, inject: () => ({ service, t, commitMarkup }),
    }, ViewerOverlay)) as (() => void) | undefined
    // Window-capture bridge: preempt the old document-capture viewer + native preview.
    const disposeBridge = installImageClickBridge({
      service,
      hostDeps,
      readBlob,
      formatNotes: annotations => noteText(annotations, t),
    })
    return () => {
      style.remove()
      disposeBridge()
      if (typeof disposeSlot === 'function') disposeSlot()
      if (typeof disposeService === 'function') disposeService()
    }
  }, 'dsh-image-gen: viewer service, overlay, styles and native-image bridge')

  shared = { service, commit, commitMarkup }
  return shared
}
