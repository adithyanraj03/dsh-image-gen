/**
 * Single source of truth for the brand colors used across the canvas surface.
 *
 * Consumed by canvas-skin-css.ts (DOM chrome via CSS variables) and
 * canvas-brand-theme.ts (export backgrounds and host theme sync), so
 * re-tinting the surface is a one-file change instead of a hex hunt across
 * two files. Values mirror the workbench tokens in studio-style.ts
 * (`--ig-blue` and friends).
 */

/** Brand blue, shared with studio-style.ts `--ig-blue`. */
export const BRAND_BLUE = '#2f64f5'
/** Brand blue RGB components, for composing rgba() tints in one place. */
export const BRAND_BLUE_RGB = '47, 100, 245'
/** Brand blue tuned for dark surfaces. */
export const BRAND_BLUE_DARK = '#5b83f8'
/** Brand blue (dark) RGB components, for composing rgba() tints. */
export const BRAND_BLUE_DARK_RGB = '91, 131, 248'
/** Cool ink from the workbench foreground family. */
export const BRAND_INK = '#182033'
/** Flat light canvas surface; also feeds export backgrounds, so it stays solid. */
export const CANVAS_BG = '#e6ebf5'
/** Canvas gradient stops (top and bottom); the mid stop is CANVAS_BG. */
export const CANVAS_BG_TOP = '#eef2fa'
export const CANVAS_BG_BOTTOM = '#dfe6f4'
/** Dark canvas base (blue-grey, matches the DSH dark shell). Solid for exports. */
export const CANVAS_BG_DARK = '#14171e'
/** Dark chrome card surface, one step above the canvas base. */
export const CANVAS_CARD_DARK = '#1d222c'
/** Dark chrome hairline border. */
export const CANVAS_BORDER_DARK = '#2c3444'
/** Dark chrome foreground. */
export const CANVAS_INK_DARK = '#e7ecf5'
/** Dot-grid tint (light / dark), painted behind the transparent editor canvas. */
export const CANVAS_DOT_LIGHT = 'rgba(88, 110, 158, 0.45)'
export const CANVAS_DOT_DARK = 'rgba(122, 140, 180, 0.34)'
/** Scene-space distance between dot-grid dots; camera-locked via CSS. */
export const CANVAS_DOT_GRID = 24
