/**
 * Node-safe unit tests for the native-image click bridge and composer
 * replace-on-save: composer vs message classification, sibling gallery build,
 * draft-attachment src matching, and release-then-add ordering. The selector
 * helpers read a minimal structural element interface, so a tiny fake DOM tree
 * exercises them without a browser; the commit helpers use a fake host.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  imageItemsForButton, installImageClickBridge, nativeImageButton, type BridgeNode,
} from '../src/client/viewer/composer-bridge.js'
import {
  captureDraftHost, commitDraftFilesReplacing, createDraftCommit, matchDraftAttachment,
  type ComposerInput, type ConversationLike, type DraftAttachmentLike, type SessionsLike,
} from '../src/client/viewer/annotations.js'
import { ImageViewerService, normalizeViewerRequest } from '../src/client/viewer/viewer-service.js'

/* ----------------------------- tiny fake DOM ----------------------------- */

interface Fake extends BridgeNode {
  attrs: Record<string, string>
  children: Fake[]
  currentSrc?: string | undefined
  alt?: string | undefined
  naturalWidth?: number | undefined
  naturalHeight?: number | undefined
}

function matchPart(node: Fake, part: string): boolean {
  const parsed = /^([a-zA-Z]+)?((?:\[[^\]]+\])*)$/.exec(part.trim())
  if (!parsed) return false
  const tag = parsed[1]
  if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false
  const attrRe = /\[([^\]=]+)(?:="([^"]*)")?\]/g
  let attr: RegExpExecArray | null
  while ((attr = attrRe.exec(parsed[2] ?? '')) !== null) {
    const name = attr[1]!
    const value = attr[2]
    if (value === undefined) { if (!node.hasAttribute(name)) return false }
    else if (node.attrs[name] !== value) return false
  }
  return true
}
const matchesSelector = (node: Fake, selector: string): boolean => selector.split(',').some(part => matchPart(node, part))
function descendants(node: Fake): Fake[] {
  const out: Fake[] = []
  const walk = (current: Fake): void => { for (const child of current.children) { out.push(child); walk(child) } }
  walk(node)
  return out
}
function queryAll(node: Fake, selector: string): Fake[] {
  const out: Fake[] = []
  for (const raw of selector.split(',')) {
    const part = raw.trim()
    const scoped = part.startsWith(':scope > ')
    const rest = scoped ? part.slice(':scope > '.length) : part
    const pool = scoped ? node.children : descendants(node)
    for (const candidate of pool) if (matchPart(candidate, rest) && !out.includes(candidate)) out.push(candidate)
  }
  return out
}
function el(tagName: string, attrs: Record<string, string> = {}, image?: { currentSrc: string; alt?: string; naturalWidth?: number; naturalHeight?: number }): Fake {
  const node: Fake = {
    tagName: tagName.toUpperCase(),
    attrs,
    children: [],
    parentElement: null,
    currentSrc: image?.currentSrc,
    alt: image?.alt ?? '',
    naturalWidth: image?.naturalWidth ?? 0,
    naturalHeight: image?.naturalHeight ?? 0,
    hasAttribute: name => name in attrs,
    matches: selector => matchesSelector(node, selector),
    closest: selector => {
      let current: Fake | null = node
      while (current !== null) { if (matchesSelector(current, selector)) return current; current = current.parentElement as Fake | null }
      return null
    },
    querySelector: selector => queryAll(node, selector)[0] ?? null,
    querySelectorAll: selector => queryAll(node, selector),
  }
  return node
}
function append(parent: Fake, ...children: Fake[]): Fake {
  for (const child of children) { child.parentElement = parent; parent.children.push(child) }
  return parent
}
const img = (src: string, alt = '', width = 0, height = 0): Fake => el('img', {}, { currentSrc: src, alt, naturalWidth: width, naturalHeight: height })
/** A button with one direct image child; returns the BUTTON (append returns the parent). */
function buttonWithImage(attrs: Record<string, string>, src: string, alt = '', width = 0, height = 0): Fake {
  const button = el('button', attrs)
  append(button, img(src, alt, width, height))
  return button
}

/* ------------------------- classification & gallery ------------------------- */

describe('nativeImageButton classification', () => {
  it('classifies a data-variant="single" message button', () => {
    const group = el('div')
    const button = buttonWithImage({ 'data-variant': 'single' }, 'blob:msg-1', 'first')
    append(group, button)
    const match = nativeImageButton(button.children[0]!)
    expect(match?.kind).toBe('message')
    expect(match?.button).toBe(button)
    expect(match?.image).toBe(button.children[0])
    expect(match?.group).toBe(group)
  })

  it('classifies a data-variant="tile" message button', () => {
    const button = buttonWithImage({ 'data-variant': 'tile' }, 'blob:tile')
    append(el('div'), button)
    expect(nativeImageButton(button)?.kind).toBe('message')
  })

  it('classifies a titled button inside a role="group" composer rail', () => {
    const rail = el('div', { role: 'group' })
    const button = buttonWithImage({ title: 'photo.png' }, 'blob:draft-1', 'photo.png')
    append(rail, button)
    const match = nativeImageButton(button.children[0]!)
    expect(match?.kind).toBe('composer')
    expect(match?.group).toBe(rail)
  })

  it('matches when the click target is the button itself', () => {
    const rail = el('div', { role: 'group' })
    const button = buttonWithImage({ title: 'x' }, 'blob:x')
    append(rail, button)
    expect(nativeImageButton(button)?.kind).toBe('composer')
  })

  it('ignores buttons without a direct image child', () => {
    const rail = el('div', { role: 'group' })
    const button = el('button', { title: 'x' })
    append(rail, button)
    expect(nativeImageButton(button)).toBeUndefined()
  })

  it('ignores an image whose currentSrc is empty', () => {
    const button = buttonWithImage({ 'data-variant': 'single' }, '')
    append(el('div'), button)
    expect(nativeImageButton(button.children[0]!)).toBeUndefined()
  })

  it('ignores a composer-rail button without a title', () => {
    const rail = el('div', { role: 'group' })
    const button = buttonWithImage({}, 'blob:x')
    append(rail, button)
    expect(nativeImageButton(button)).toBeUndefined()
  })

  it('ignores plain buttons and null targets', () => {
    const button = buttonWithImage({}, 'blob:x')
    append(el('div'), button)
    expect(nativeImageButton(button)).toBeUndefined()
    expect(nativeImageButton(null)).toBeUndefined()
    expect(nativeImageButton(el('span'))).toBeUndefined()
  })
})

describe('imageItemsForButton sibling gallery', () => {
  it('builds the composer rail gallery in order with the clicked index', () => {
    const rail = el('div', { role: 'group' })
    const ba = buttonWithImage({ title: 'a' }, 'blob:a', 'a.png', 100, 80)
    const bb = buttonWithImage({ title: 'b' }, 'blob:b', 'b.png', 200, 160)
    const bc = buttonWithImage({ title: 'c' }, 'blob:c', 'c.png')
    append(rail, ba, bb, bc)
    const match = nativeImageButton(bb.children[0]!)!
    const { items, index } = imageItemsForButton(match)
    expect(index).toBe(1)
    expect(items.map(item => item.src)).toEqual(['blob:a', 'blob:b', 'blob:c'])
    expect(items.map(item => item.name)).toEqual(['a.png', 'b.png', 'c.png'])
    expect(items[0]).toMatchObject({ width: 100, height: 80 })
    expect(items[2]?.width).toBeUndefined()
    expect(ba.children.length).toBe(1)
    expect(bc.children.length).toBe(1)
  })

  it('excludes composer buttons nested in a different role="group"', () => {
    const rail = el('div', { role: 'group' })
    const own = buttonWithImage({ title: 'own' }, 'blob:own')
    append(rail, own)
    const nested = el('div', { role: 'group' })
    append(nested, buttonWithImage({ title: 'nested' }, 'blob:nested'))
    append(rail, nested)
    const match = nativeImageButton(own.children[0]!)!
    const { items } = imageItemsForButton(match)
    expect(items.map(item => item.src)).toEqual(['blob:own'])
  })

  it('builds a message gallery from single + tile siblings', () => {
    const group = el('div')
    const single = buttonWithImage({ 'data-variant': 'single' }, 'blob:s')
    const tile = buttonWithImage({ 'data-variant': 'tile' }, 'blob:t')
    const plain = buttonWithImage({}, 'blob:ignored')
    append(group, single, tile, plain)
    const match = nativeImageButton(tile.children[0]!)!
    const { items, index } = imageItemsForButton(match)
    expect(items.map(item => item.src)).toEqual(['blob:s', 'blob:t'])
    expect(index).toBe(1)
    expect(single.children.length).toBe(1)
  })

  it('falls back to the single clicked image when no siblings qualify', () => {
    const button = buttonWithImage({ 'data-variant': 'single' }, 'blob:only', 'only.png', 64, 48)
    append(el('div'), button)
    const match = nativeImageButton(button.children[0]!)!
    match.group = null
    const { items, index } = imageItemsForButton(match)
    expect(index).toBe(0)
    expect(items).toEqual([{ id: 'blob:only', src: 'blob:only', name: 'only.png', width: 64, height: 48 }])
  })
})

/* --------------------------- draft src matching --------------------------- */

describe('matchDraftAttachment', () => {
  const attachments: DraftAttachmentLike[] = [
    { kind: 'file', id: 'file-1', previewUrl: 'blob:shared' },
    { kind: 'image', id: 'img-1', previewUrl: 'blob:one' },
    { kind: 'image', id: 'img-2', url: 'blob:two' },
    { kind: 'image', id: 'img-3', src: 'blob:three' },
  ]

  it('matches an image draft by previewUrl', () => {
    expect(matchDraftAttachment(attachments, 'blob:one')?.id).toBe('img-1')
  })

  it('matches alternate url / src fields', () => {
    expect(matchDraftAttachment(attachments, 'blob:two')?.id).toBe('img-2')
    expect(matchDraftAttachment(attachments, 'blob:three')?.id).toBe('img-3')
  })

  it('never matches a file-kind draft', () => {
    expect(matchDraftAttachment(attachments, 'blob:shared')).toBeUndefined()
  })

  it('returns undefined for empty src or no match', () => {
    expect(matchDraftAttachment(attachments, '')).toBeUndefined()
    expect(matchDraftAttachment(attachments, 'blob:missing')).toBeUndefined()
    expect(matchDraftAttachment([], 'blob:one')).toBeUndefined()
  })
})

/* ----------------------- replace-then-add commit core ----------------------- */

function replaceHarness(options?: {
  attachments?: DraftAttachmentLike[]
  phase?: string
  occurrences?: unknown[]
  draft?: string
  addResult?: boolean
  removeResult?: boolean
  legacy?: boolean
}) {
  const order: string[] = []
  const attachments = options?.attachments ?? []
  const state = {
    current: 'session-1',
    phase: options?.phase ?? 'plain',
    occurrences: options?.occurrences ?? [] as unknown[],
    draft: options?.draft ?? '',
    attachmentIds: attachments.map(attachment => attachment.id),
  }
  const sessions: SessionsLike = { list: { getSnapshot: () => ({ current: state.current }) }, scope: id => ({ scopeId: id }) }
  const input: ComposerInput = {
    state: { getSnapshot: () => ({ phase: state.phase, occurrences: state.occurrences, draft: state.draft, attachmentIds: state.attachmentIds }) },
    setDraft: text => { order.push('setDraft'); state.draft = text },
    removeAttachment: id => { order.push(`remove:${id}`); state.attachmentIds = state.attachmentIds.filter(value => value !== id); return options?.removeResult ?? true },
  }
  const add = (ids: string[]): boolean => { order.push(`add:${ids.join(',')}`); const ok = options?.addResult ?? true; if (ok) state.attachmentIds = [...state.attachmentIds, ...ids]; return ok }
  const conversation: ConversationLike = {
    input: { for: () => input },
    resolveDraftAttachments: ids => { order.push('resolve'); return attachments.filter(attachment => ids.includes(attachment.id)) },
  }
  if (options?.legacy) {
    input.addImages = add
    conversation.createDraftImages = files => { order.push('create'); return files.map((_, index) => ({ id: `img-${index}` })) }
    conversation.releaseDraftImages = batch => { order.push(`release:${batch.map(entry => entry.id).join(',')}`) }
  } else {
    input.addAttachments = add
    conversation.createDrafts = (_sessionId, files) => { order.push('create'); return files.map((_, index) => ({ id: `draft-${index}` })) }
    conversation.releaseDraftAttachments = batch => { order.push(`release:${batch.map(entry => entry.id).join(',')}`) }
  }
  const host = captureDraftHost({ getSessions: () => sessions, getConversation: () => conversation })
  return { host, state, order }
}

const markedFile = (): { file: File; text: string } => ({
  file: new File([new Blob(['png-bytes'], { type: 'image/png' })], 'photo-marked.png', { type: 'image/png' }),
  text: 'photo-marked.png',
})
const imageAttachment = (id: string, previewUrl: string): DraftAttachmentLike => ({
  kind: 'image', id, previewUrl, file: new File([new Blob(['original'])], 'photo.png', { type: 'image/png' }),
})

describe('commitDraftFilesReplacing (composer origin)', () => {
  it('releases the matched draft id BEFORE adding the marked PNG and preserves draft text', async () => {
    const harness = replaceHarness({ attachments: [imageAttachment('att-1', 'blob:photo')], draft: 'existing draft' })
    const outcome = await commitDraftFilesReplacing(harness.host, 'blob:photo', [markedFile()])
    expect(outcome).toBe('replaced')
    expect(harness.order).toEqual(['resolve', 'remove:att-1', 'release:att-1', 'create', 'add:draft-0', 'setDraft'])
    expect(harness.state.draft).toBe('existing draft\n\nphoto-marked.png')
    expect(harness.state.attachmentIds).toEqual(['draft-0'])
  })

  it('falls back to ADD-alongside when no live attachment matches the src', async () => {
    const harness = replaceHarness({ attachments: [imageAttachment('att-1', 'blob:other')], draft: 'keep me' })
    const outcome = await commitDraftFilesReplacing(harness.host, 'blob:photo', [markedFile()])
    expect(outcome).toBe('added')
    expect(harness.order).toEqual(['resolve', 'create', 'add:draft-0', 'setDraft'])
    expect(harness.state.draft).toBe('keep me\n\nphoto-marked.png')
    expect(harness.state.attachmentIds).toEqual(['att-1', 'draft-0'])
  })

  it('falls back to ADD when the draft list is empty (attachment already sent/evicted)', async () => {
    const harness = replaceHarness({ attachments: [] })
    expect(await commitDraftFilesReplacing(harness.host, 'blob:photo', [markedFile()])).toBe('added')
    expect(harness.order.some(entry => entry.startsWith('remove:'))).toBe(false)
    expect(harness.order.some(entry => entry.startsWith('release:'))).toBe(false)
  })

  it('falls back to ADD when removeAttachment refuses (busy admission)', async () => {
    const harness = replaceHarness({ attachments: [imageAttachment('att-1', 'blob:photo')], removeResult: false })
    expect(await commitDraftFilesReplacing(harness.host, 'blob:photo', [markedFile()])).toBe('added')
    expect(harness.order).toEqual(['resolve', 'remove:att-1', 'create', 'add:draft-0', 'setDraft'])
    expect(harness.order.some(entry => entry.startsWith('release:'))).toBe(false)
  })

  it('refuses while the composer is busy, without removing; references do not block', async () => {
    const busy = replaceHarness({ attachments: [imageAttachment('att-1', 'blob:photo')], phase: 'submitting' })
    await expect(commitDraftFilesReplacing(busy.host, 'blob:photo', [markedFile()])).rejects.toThrow(/busy/i)
    expect(busy.order.some(entry => entry.startsWith('remove:'))).toBe(false)
    const refs = replaceHarness({ attachments: [imageAttachment('att-1', 'blob:photo')], occurrences: [{ kind: 'mention' }] })
    expect(await commitDraftFilesReplacing(refs.host, 'blob:photo', [markedFile()])).toBe('replaced')
  })

  it('refuses when the session changed since capture', async () => {
    const harness = replaceHarness({ attachments: [imageAttachment('att-1', 'blob:photo')] })
    harness.state.current = 'session-2'
    await expect(commitDraftFilesReplacing(harness.host, 'blob:photo', [markedFile()])).rejects.toThrow(/session changed|unavailable/i)
    expect(harness.order.some(entry => entry.startsWith('remove:'))).toBe(false)
  })

  it('uses the legacy draft-images API for release-then-add', async () => {
    const harness = replaceHarness({ attachments: [imageAttachment('att-1', 'blob:photo')], legacy: true })
    expect(await commitDraftFilesReplacing(harness.host, 'blob:photo', [markedFile()])).toBe('replaced')
    expect(harness.order).toEqual(['resolve', 'remove:att-1', 'release:att-1', 'create', 'add:img-0', 'setDraft'])
  })

  it('restores the original attachment when the add fails after release', async () => {
    const harness = replaceHarness({ attachments: [imageAttachment('att-1', 'blob:photo')], addResult: false })
    await expect(commitDraftFilesReplacing(harness.host, 'blob:photo', [markedFile()])).rejects.toThrow(/busy/i)
    // release happened, the failed add released its own draft, then a restore create+add ran.
    expect(harness.order.filter(entry => entry === 'create').length).toBe(2)
    expect(harness.order).toContain('release:att-1')
  })

  it('does nothing for empty files', async () => {
    const harness = replaceHarness({ attachments: [imageAttachment('att-1', 'blob:photo')] })
    expect(await commitDraftFilesReplacing(harness.host, 'blob:photo', [])).toBe('added')
    expect(harness.order).toEqual([])
  })
})

describe('createDraftCommit replace path (region notes)', () => {
  it('replaces the originating draft attachment with the annotated PNG', async () => {
    const harness = replaceHarness({ attachments: [imageAttachment('att-1', 'blob:photo')], draft: 'notes please' })
    const commit = createDraftCommit({
      getSessions: () => harness.host.sessions,
      getConversation: () => harness.host.conversation,
      readBlob: async () => new Blob(['original'], { type: 'image/png' }),
      formatNotes: () => 'Region 1 (50%, 50%): fix this',
      render: async () => new Blob(['annotated'], { type: 'image/png' }),
      replace: true,
    })
    await commit([{ item: { src: 'blob:photo', name: 'photo.jpg' }, annotations: [{ id: 'a', x: 0.5, y: 0.5, note: 'fix this' }] }])
    expect(harness.order).toContain('remove:att-1')
    expect(harness.order).toContain('release:att-1')
    expect(harness.order.indexOf('release:att-1')).toBeLessThan(harness.order.indexOf('create'))
    expect(harness.state.draft).toContain('photo-annotated.png')
    expect(harness.state.draft).toContain('Region 1 (50%, 50%): fix this')
    expect(harness.state.draft.startsWith('notes please')).toBe(true)
  })
})

/* ------------------------------ origin wiring ------------------------------ */

describe('viewer request origin', () => {
  it('normalizeViewerRequest preserves a valid origin and drops invalid ones', () => {
    const composer = normalizeViewerRequest({ items: [{ src: 'blob:x' }], origin: 'composer' })
    expect(composer?.origin).toBe('composer')
    const message = normalizeViewerRequest({ items: [{ src: 'blob:x' }], origin: 'message' })
    expect(message?.origin).toBe('message')
    const invalid = normalizeViewerRequest({ items: [{ src: 'blob:x' }], origin: 'workbench' as never })
    expect(invalid?.origin).toBeUndefined()
    const absent = normalizeViewerRequest({ items: [{ src: 'blob:x' }] })
    expect(absent?.origin).toBeUndefined()
  })

  it('service.open carries origin into the snapshot the overlay reads', () => {
    const service = new ImageViewerService()
    expect(service.open({ items: [{ src: 'blob:x' }], origin: 'composer' })).toBe(true)
    expect(service.getSnapshot()?.origin).toBe('composer')
    expect(service.open({ items: [{ src: 'blob:y' }], origin: 'message' })).toBe(true)
    expect(service.getSnapshot()?.origin).toBe('message')
  })
})

describe('installImageClickBridge (window capture)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  function stubWindow() {
    const listeners: { type: string; handler: (event: unknown) => void; capture: boolean }[] = []
    const fakeWindow = {
      addEventListener: vi.fn((type: string, handler: (event: unknown) => void, capture?: boolean) => { listeners.push({ type, handler, capture: capture === true }) }),
      removeEventListener: vi.fn((type: string, handler: (event: unknown) => void, capture?: boolean) => {
        const index = listeners.findIndex(entry => entry.type === type && entry.handler === handler && entry.capture === (capture === true))
        if (index >= 0) listeners.splice(index, 1)
      }),
    }
    vi.stubGlobal('window', fakeWindow)
    return { fakeWindow, listeners }
  }

  it('registers a CAPTURE-phase click listener and opens the shared viewer with composer origin', () => {
    const { fakeWindow, listeners } = stubWindow()
    const service = new ImageViewerService()
    const dispose = installImageClickBridge({
      service,
      hostDeps: { getSessions: () => undefined, getConversation: () => undefined },
      readBlob: async () => new Blob(['x'], { type: 'image/png' }),
      formatNotes: () => '',
    })
    expect(fakeWindow.addEventListener).toHaveBeenCalledTimes(1)
    expect(listeners[0]?.type).toBe('click')
    expect(listeners[0]?.capture).toBe(true)

    const rail = el('div', { role: 'group' })
    const ba = buttonWithImage({ title: 'a' }, 'blob:a', 'a.png')
    const bb = buttonWithImage({ title: 'b' }, 'blob:b', 'b.png')
    append(rail, ba, bb)
    const event = { target: bb.children[0], preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() }
    listeners[0]?.handler(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    const snapshot = service.getSnapshot()
    expect(snapshot?.origin).toBe('composer')
    expect(snapshot?.source).toBe('dsh-image-gen-bridge')
    expect(snapshot?.items.map(item => item.src)).toEqual(['blob:a', 'blob:b'])
    expect(snapshot?.index).toBe(1)
    expect(typeof snapshot?.commitAnnotations).toBe('function')

    dispose()
    expect(fakeWindow.removeEventListener).toHaveBeenCalledTimes(1)
    expect(listeners.length).toBe(0)
  })

  it('opens message-origin previews without replace and ignores non-image clicks', () => {
    const { listeners } = stubWindow()
    const service = new ImageViewerService()
    installImageClickBridge({
      service,
      hostDeps: { getSessions: () => undefined, getConversation: () => undefined },
      readBlob: async () => new Blob(['x']),
      formatNotes: () => '',
    })
    const group = el('div')
    const button = buttonWithImage({ 'data-variant': 'single' }, 'blob:m', 'm.png')
    append(group, button)
    const event = { target: button.children[0], preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() }
    listeners[0]?.handler(event)
    expect(service.getSnapshot()?.origin).toBe('message')

    const plain = { target: el('span'), preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() }
    listeners[0]?.handler(plain)
    expect(plain.preventDefault).not.toHaveBeenCalled()
    expect(service.getSnapshot()?.origin).toBe('message')
  })

  it('is a no-op disposer when window is absent (SSR/node)', () => {
    vi.stubGlobal('window', undefined)
    const service = new ImageViewerService()
    const dispose = installImageClickBridge({
      service,
      hostDeps: { getSessions: () => undefined, getConversation: () => undefined },
      readBlob: async () => new Blob(['x']),
      formatNotes: () => '',
    })
    expect(() => { dispose() }).not.toThrow()
    expect(service.getSnapshot()).toBeUndefined()
  })
})
