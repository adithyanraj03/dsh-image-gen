/**
 * Region annotations: numbered pins, note text, and the annotated-PNG →
 * composer-draft commit.
 *
 * Ported from dsh-image-viewer@0.1.20 (WSL043, MIT) src/annotation-draft.js.
 * The render bakes numbered markers into a copy of the ORIGINAL pixels; the
 * commit attaches that PNG plus the note text to the current session draft
 * WITHOUT sending, and refuses if the session changed or the composer is busy.
 */

export interface Annotation { id: string; x: number; y: number; note: string }
export interface CommitItem { src: string; name?: string }
export interface CommitEntry { item: CommitItem; annotations: Annotation[] }

/** Draw numbered markers onto the original image and re-encode as PNG. */
export async function renderAnnotationImage(blob: Blob, annotations: Annotation[]): Promise<Blob> {
  const image = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.drawImage(image, 0, 0)
    const radius = Math.max(12, Math.min(image.width, image.height) / 60)
    annotations.forEach((annotation, index) => {
      const x = Math.max(radius, Math.min(image.width - radius, annotation.x * image.width))
      const y = Math.max(radius, Math.min(image.height - radius, annotation.y * image.height))
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fillStyle = '#26272a'
      context.fill()
      context.strokeStyle = '#ffffff'
      context.lineWidth = Math.max(2, radius / 7)
      context.stroke()
      context.fillStyle = '#ffffff'
      context.font = `600 ${radius}px sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(String(index + 1), x, y)
    })
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed')), 'image/png'))
  } finally { image.close() }
}

const hasOwn = Object.prototype.hasOwnProperty

/** Legacy hosts expose `list.current`; alpha2 keeps it in the retention projection. */
export function currentSessionId(snapshot: unknown): string | undefined {
  if (snapshot !== null && typeof snapshot === 'object' && hasOwn.call(snapshot, 'current')) {
    return (snapshot as { current?: string }).current
  }
  const byId = (snapshot as { byId?: Record<string, { retainedBy?: { mainView?: number } }> })?.byId ?? {}
  const retained = Object.entries(byId).filter(([, entry]) => (entry?.retainedBy?.mainView ?? 0) > 0)
  const first = retained[0]
  return retained.length === 1 && first ? first[0] : undefined
}

/** Minimal structural views of the host services the commit needs. */
export interface SessionsLike { list: { getSnapshot(): unknown }; scope(id: string): unknown }
/**
 * Structural view of one browser-owned composer draft attachment. Image drafts
 * carry an object-URL `previewUrl` (the thumbnail src); the legacy/alternate
 * hosts may expose `url`/`src` instead. `file` lets a failed replace restore the
 * original bytes after its preview URL was released.
 */
export interface DraftAttachmentLike {
  kind?: string | undefined
  id: string
  previewUrl?: string | undefined
  url?: string | undefined
  src?: string | undefined
  file?: File | undefined
}
export interface ConversationLike {
  input?: { for(scope: unknown): ComposerInput }
  createDrafts?(sessionId: string, files: File[]): { id: string }[]
  releaseDraftAttachments?(drafts: { id: string }[]): void
  createDraftImages?(files: File[]): { id: string }[]
  releaseDraftImages?(drafts: { id: string }[]): void
  /** Resolve ordered input-state attachment ids to live browser-owned drafts. */
  resolveDraftAttachments?(ids: readonly string[]): DraftAttachmentLike[]
}
export interface ComposerInput {
  state: { getSnapshot(): { phase?: string; occurrences?: unknown[]; draft?: string; attachmentIds?: readonly string[] } }
  addAttachments?(ids: string[]): boolean
  addImages?(ids: string[]): boolean
  /** Remove one browser-owned attachment id from the draft; busy phases refuse. */
  removeAttachment?(id: string): boolean
  setDraft(text: string): void
}

export interface DraftCommitDeps {
  getSessions(): SessionsLike | undefined
  getConversation(): ConversationLike | undefined
  readBlob(src: string): Promise<Blob>
  formatNotes(annotations: Annotation[]): string
  render?(blob: Blob, annotations: Annotation[]): Promise<Blob>
  /** Composer-origin previews replace the originating draft attachment by src. */
  replace?: boolean | undefined
}

/** A prepared file + the draft text line that accompanies it. */
export interface DraftFile { file: File; text: string }
export interface DraftHostDeps {
  getSessions(): SessionsLike | undefined
  getConversation(): ConversationLike | undefined
}
/** Session destination captured once (when the viewer registers), never re-pinned. */
export interface DraftCommitHost {
  sessions: SessionsLike | undefined
  conversation: ConversationLike | undefined
  sessionId: string | undefined
}

export function captureDraftHost(deps: DraftHostDeps): DraftCommitHost {
  let sessions: SessionsLike | undefined
  let conversation: ConversationLike | undefined
  let sessionId: string | undefined
  try {
    sessions = deps.getSessions()
    conversation = deps.getConversation()
    sessionId = sessions ? currentSessionId(sessions.list.getSnapshot()) : undefined
  } catch { /* The viewer also works without a conversation host. */ }
  return { sessions, conversation, sessionId }
}

export function draftHostReady(host: DraftCommitHost): boolean {
  return host.sessionId !== undefined && host.conversation?.input?.for !== undefined && host.sessions !== undefined
    && currentSessionId(host.sessions.list.getSnapshot()) === host.sessionId
}

/**
 * Attach prepared files to the pinned session's composer draft WITHOUT sending.
 * Shared by the region-note commit and the markup (baked-PNG) commit: session
 * re-validation, composer-busy guard, legacy/modern draft API fallback, and
 * release-on-failure so a refused add never leaks draft attachments.
 */
export async function commitDraftFiles(host: DraftCommitHost, files: DraftFile[]): Promise<void> {
  const { sessions, conversation, sessionId } = host
  if (!sessionId || !conversation?.input?.for || !sessions || currentSessionId(sessions.list.getSnapshot()) !== sessionId) {
    throw new Error('Composer unavailable or session changed')
  }
  if (files.length === 0) return
  if (currentSessionId(sessions.list.getSnapshot()) !== sessionId) throw new Error('Session changed')
  const input = conversation.input.for(sessions.scope(sessionId))
  const state = input.state.getSnapshot()
  if (state.phase !== 'plain' || state.occurrences?.length) throw new Error('Composer busy or contains references')
  const modern = typeof conversation.createDrafts === 'function'
  const add = modern ? input.addAttachments : input.addImages
  const release = modern ? conversation.releaseDraftAttachments : conversation.releaseDraftImages
  if (typeof add !== 'function' || typeof release !== 'function') throw new Error('Composer unavailable')
  const created = modern ? conversation.createDrafts!(sessionId, files.map(item => item.file)) : conversation.createDraftImages!(files.map(item => item.file))
  try {
    if (!add.call(input, created.map(item => item.id))) throw new Error('Composer busy')
  } catch (error) { release.call(conversation, created); throw error }
  input.setDraft([state.draft, ...files.map(item => item.text)].filter(Boolean).join('\n\n'))
}

/**
 * Find the live composer draft attachment whose preview URL equals `src`.
 * Only image drafts carry a preview URL, so file drafts never match. Pure and
 * node-safe: the bridge passes the resolved `input.state` attachment list.
 */
export function matchDraftAttachment(attachments: readonly DraftAttachmentLike[], src: string): DraftAttachmentLike | undefined {
  if (typeof src !== 'string' || src === '') return undefined
  return attachments.find(attachment => attachment !== undefined && attachment !== null
    && attachment.kind !== 'file'
    && (attachment.previewUrl === src || attachment.url === src || attachment.src === src))
}

/** Outcome of a composer-origin commit: replaced the source draft, or added. */
export type DraftReplaceOutcome = 'replaced' | 'added'

/** Best-effort restore of a released attachment so a failed replace never loses it. */
function restoreReleasedAttachment(host: DraftCommitHost, attachment: DraftAttachmentLike): void {
  const { sessions, conversation, sessionId } = host
  if (!sessions || !conversation || !sessionId || !attachment.file || !conversation.input?.for) return
  try {
    const input = conversation.input.for(sessions.scope(sessionId))
    const modern = typeof conversation.createDrafts === 'function'
    const created = modern ? conversation.createDrafts!(sessionId, [attachment.file]) : conversation.createDraftImages?.([attachment.file])
    if (!created?.length) return
    const add = modern ? input.addAttachments : input.addImages
    add?.call(input, created.map(entry => entry.id))
  } catch { /* Never mask the original commit error. */ }
}

/**
 * Composer-origin commit: REPLACE the draft attachment whose preview URL is
 * `src` with the prepared files, preserving the existing draft text. The source
 * id is removed and its browser object released BEFORE the marked file is added
 * (release-then-add). When no live attachment matches (already sent/evicted) it
 * falls back to ADD-alongside and reports `'added'` so the caller can toast.
 */
export async function commitDraftFilesReplacing(host: DraftCommitHost, src: string, files: DraftFile[]): Promise<DraftReplaceOutcome> {
  const { sessions, conversation, sessionId } = host
  if (!sessionId || !conversation?.input?.for || !sessions || currentSessionId(sessions.list.getSnapshot()) !== sessionId) {
    throw new Error('Composer unavailable or session changed')
  }
  if (files.length === 0) return 'added'
  const input = conversation.input.for(sessions.scope(sessionId))
  const state = input.state.getSnapshot()
  if (state.phase !== 'plain' || state.occurrences?.length) throw new Error('Composer busy or contains references')
  const attachments = conversation.resolveDraftAttachments?.(state.attachmentIds ?? []) ?? []
  const matched = matchDraftAttachment(attachments, src)
  if (matched && typeof input.removeAttachment === 'function' && input.removeAttachment(matched.id)) {
    const release = typeof conversation.releaseDraftAttachments === 'function' ? conversation.releaseDraftAttachments : conversation.releaseDraftImages
    release?.call(conversation, [matched])
    try {
      await commitDraftFiles(host, files)
      return 'replaced'
    } catch (error) {
      restoreReleasedAttachment(host, matched)
      throw error
    }
  }
  await commitDraftFiles(host, files)
  return 'added'
}

/**
 * Capture the destination when the viewer opens, validate again after async
 * image preparation. Never send or redirect another session.
 */
export function createDraftCommit(deps: DraftCommitDeps): (entries: CommitEntry[]) => Promise<void> {
  const render = deps.render ?? renderAnnotationImage
  const host = captureDraftHost(deps)
  return async entries => {
    if (!draftHostReady(host)) throw new Error('Composer unavailable or session changed')
    const prepared = await Promise.all(entries.map(async ({ item, annotations }) => {
      const image = await render(await deps.readBlob(item.src), annotations)
      const name = `${String(item.name || 'image').replace(/\.[^.]+$/, '')}-annotated.png`
      return { item, file: new File([image], name, { type: 'image/png' }), text: `${name}\n${deps.formatNotes(annotations)}` }
    }))
    if (deps.replace) {
      for (const { item, file, text } of prepared) await commitDraftFilesReplacing(host, item.src, [{ file, text }])
      return
    }
    await commitDraftFiles(host, prepared.map(({ file, text }) => ({ file, text })))
  }
}
