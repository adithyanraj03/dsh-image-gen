/**
 * Click-to-place geometry and gesture guards for the infinite canvas.
 * Pure and DOM-free so node tests drive the exact math and rules the
 * Excalidraw mount applies; the component supplies real event values.
 */

/**
 * Excalidraw renders every toolbar/menu/panel as DOM chrome above the
 * drawing canvas (the `.layer-ui__wrapper` layer is pointer-events:none,
 * its islands re-enable it). Placement must never fire on those islands.
 */
export const EXCALIDRAW_CHROME_SELECTOR = '.layer-ui__wrapper, .App-toolbar, .dropdown-menu, .context-menu, .sidebar, .popover, .Modal, .excalidraw__embeddable-container'

/** Pointer movement (px) still considered a plain click, not a drag/pan. */
export const PLACE_CLICK_SLOP_PX = 6

export interface PlacementPointer {
  button: number
  clientX: number
  clientY: number
}

/**
 * Convert a client-space click into Excalidraw scene space using the mount
 * container's bounding rect and the camera state:
 *   sceneX = (clientX - rect.left - scrollX) / zoom
 * Matches viewportOf(): the container's top-left corner maps to
 * (-scrollX/zoom, -scrollY/zoom). A non-positive zoom falls back to 1 so a
 * transient camera state can never divide by zero.
 */
export function clientToScenePoint(
  point: { clientX: number; clientY: number },
  rect: { left: number; top: number },
  camera: { scrollX: number; scrollY: number; zoom: number },
): { x: number; y: number } {
  const zoom = camera.zoom > 0 ? camera.zoom : 1
  return {
    x: (point.clientX - rect.left - camera.scrollX) / zoom,
    y: (point.clientY - rect.top - camera.scrollY) / zoom,
  }
}

/** A placement gesture is a left-button press/release pair without a drag. */
export function isPlainLeftClick(down: PlacementPointer | null, up: PlacementPointer, slop: number = PLACE_CLICK_SLOP_PX): boolean {
  if (down === null || down.button !== 0 || up.button !== 0) return false
  return Math.hypot(up.clientX - down.clientX, up.clientY - down.clientY) <= slop
}

/**
 * True only for the interactive drawing canvas. Excalidraw's static canvas
 * and wrapper are pointer-events:none, so any CANVAS target is the live
 * surface; every toolbar/menu/panel is HTML chrome and never qualifies.
 * The closest() check stays defensive should a canvas ever sit inside UI.
 */
export function isPlacementSurfaceTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false
  const element = target as { tagName?: unknown; closest?: unknown }
  if (element.tagName !== 'CANVAS') return false
  if (typeof element.closest !== 'function') return true
  return (element.closest as (selectors: string) => unknown)(EXCALIDRAW_CHROME_SELECTOR) == null
}
