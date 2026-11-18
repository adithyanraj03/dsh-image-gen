/**
 * Native-image click bridge: opens OUR shared lightbox (Markup + region notes)
 * when the user clicks a composer draft thumbnail or a message image, preempting
 * the still-installed old dsh-image-viewer document-capture bridge and the host
 * native preview.
 *
 * Selectors are ported from the proven dsh-image-viewer core (WSL043, MIT):
 *   message  = button[data-variant="single"|"tile"] with a :scope > img child
 *   composer = button[title] inside a [role="group"] rail
 * The gallery is built from sibling buttons exactly like imageItemsForButton.
 *
 * The selector/matching helpers are pure and node-safe (they read a minimal
 * structural element interface, not concrete DOM classes), so they unit-test
 * without a browser. `installImageClickBridge` is the only DOM-touching part and
 * registers on WINDOW in CAPTURE phase — window capture fires before document
 * capture, so it wins over the old bridge.
 */
import type { Annotation, DraftHostDeps } from './annotations.js'
import { createDraftCommit } from './annotations.js'
import type { ImageViewerService, ViewerItem, ViewerOrigin } from './viewer-service.js'

/** Minimal structural element the bridge reads; real DOM elements satisfy it. */
export interface BridgeNode {
  tagName: string
  parentElement: BridgeNode | null
  hasAttribute(name: string): boolean
  matches(selector: string): boolean
  closest(selector: string): BridgeNode | null
  querySelector(selector: string): BridgeNode | null
  querySelectorAll(selector: string): ArrayLike<BridgeNode>
}
/** A direct image child carrying the pixels the gallery item describes. */
export interface BridgeImageNode extends BridgeNode {
  currentSrc: string
  alt: string
  naturalWidth: number
  naturalHeight: number
}
export interface ImageMatch {
  button: BridgeNode
  image: BridgeImageNode
  group: BridgeNode | null
  kind: ViewerOrigin
}

const isImageNode = (node: BridgeNode | null): node is BridgeImageNode =>
  node !== null && typeof (node as BridgeImageNode).currentSrc === 'string' && (node as BridgeImageNode).currentSrc !== ''

/** Classify a click target as a message or composer image button, or undefined. */
export function nativeImageButton(target: BridgeNode | null): ImageMatch | undefined {
  const button = target?.closest('button') ?? null
  if (button === null || button.tagName !== 'BUTTON') return undefined
  const image = button.querySelector(':scope > img')
  if (!isImageNode(image)) return undefined
  if (button.matches('[data-variant="single"],[data-variant="tile"]')) {
    return { button, image, group: button.parentElement, kind: 'message' }
  }
  const rail = button.closest('[role="group"]')
  if (rail !== null && button.hasAttribute('title')) return { button, image, group: rail, kind: 'composer' }
  return undefined
}

/** Build the sibling gallery (items + clicked index) for a matched button. */
export function imageItemsForButton(match: ImageMatch): { items: Omit<ViewerItem, 'actions'>[]; index: number } {
  const selector = match.kind === 'message'
    ? ':scope > button[data-variant="single"],:scope > button[data-variant="tile"]'
    : 'button[title]'
  const buttons = match.group !== null ? Array.from(match.group.querySelectorAll(selector)) : []
  const candidates = buttons.flatMap((button, position) => {
    if (match.kind === 'composer' && button.closest('[role="group"]') !== match.group) return []
    const image = button.querySelector(':scope > img')
    if (!isImageNode(image)) return []
    return [{
      id: image.currentSrc,
      src: image.currentSrc,
      name: image.alt || `Image ${position + 1}`,
      width: image.naturalWidth || undefined,
      height: image.naturalHeight || undefined,
      button,
    }]
  })
  const items = candidates.length > 0 ? candidates : [{
    id: match.image.currentSrc,
    src: match.image.currentSrc,
    name: match.image.alt || 'Image',
    width: match.image.naturalWidth || undefined,
    height: match.image.naturalHeight || undefined,
    button: match.button,
  }]
  const index = Math.max(0, items.findIndex(item => item.button === match.button))
  return { items: items.map(({ button: _button, ...item }) => item), index }
}

export interface ImageBridgeDeps {
  service: ImageViewerService
  hostDeps: DraftHostDeps
  readBlob(src: string): Promise<Blob>
  formatNotes(annotations: Annotation[]): string
}

/**
 * Register the window-capture click bridge. Returns a disposer. Composer-origin
 * opens carry `origin: 'composer'` and a replace-aware region-note commit; the
 * lightbox derives `draftReplace` from the origin for Markup Save.
 */
export function installImageClickBridge(deps: ImageBridgeDeps): () => void {
  // No window (SSR / node tests): there is no click surface to bridge.
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
  const onClick = (event: MouseEvent): void => {
    const match = nativeImageButton(event.target as BridgeNode | null)
    if (match === undefined) return
    const { items, index } = imageItemsForButton(match)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const origin = match.kind
    const commitAnnotations = createDraftCommit({
      ...deps.hostDeps,
      readBlob: deps.readBlob,
      formatNotes: deps.formatNotes,
      replace: origin === 'composer',
    })
    const gallery: ViewerItem[] = items.map(item => ({ ...item, readBlob: () => deps.readBlob(item.src) }))
    deps.service.open({
      items: gallery,
      index,
      opener: match.button as unknown as HTMLElement,
      source: 'dsh-image-gen-bridge',
      annotations: true,
      commitAnnotations,
      origin,
    })
  }
  window.addEventListener('click', onClick, true)
  return () => { window.removeEventListener('click', onClick, true) }
}
