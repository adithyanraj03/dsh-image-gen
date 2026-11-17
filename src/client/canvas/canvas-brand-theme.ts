import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { CANVAS_BG, CANVAS_BG_DARK } from './canvas-brand-tokens.js'

/**
 * Host theme bridge for the Excalidraw surface.
 *
 * Excalidraw has no runtime palette API: canvas-rendered colors follow its
 * built-in light/dark themes, and the brand tint is applied through CSS
 * variables (canvas-skin-css.ts). This module owns the light/dark decision —
 * the DSH host publishes dark mode as data-ds-dark-theme on <body> — plus the
 * solid background used for selection exports (the live editor canvas is
 * transparent so the CSS dot grid can show through).
 */

export type HostTheme = 'light' | 'dark'

/** The host's current color scheme; light when no document exists (tests). */
export function hostTheme(): HostTheme {
  return typeof document !== 'undefined' && document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
}

/** Solid export background matching the live surface's theme. */
export function canvasExportBackground(theme: HostTheme): string {
  return theme === 'dark' ? CANVAS_BG_DARK : CANVAS_BG
}

/**
 * Match Excalidraw's light/dark theme to the DSH host theme, now and on later
 * flips. Returns the observer disposer.
 */
export function syncCanvasThemeWithHost(api: ExcalidrawImperativeAPI): () => void {
  const apply = (): void => {
    api.updateScene({ appState: { theme: hostTheme() } })
  }
  apply()
  const observer = new MutationObserver(apply)
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  return () => observer.disconnect()
}
