/**
 * DSH image-gen brand skin for the Excalidraw surface.
 *
 * Injected AFTER the bundled Excalidraw styles (canvas-css.ts): it only
 * re-declares Excalidraw's own CSS variables and restyles Excalidraw's own
 * chrome classes, scoped to our canvas container, so upgrading Excalidraw
 * never requires edits here. The composition mirrors the workbench card
 * language: a vertical tool strip on the left, the color/stroke panel on the
 * right, the zoom cluster at the bottom, and a camera-locked dot grid painted
 * behind the transparent editor canvas. No watermark is added or removed —
 * Excalidraw (MIT) ships none.
 */

import { BRAND_BLUE, BRAND_BLUE_DARK, BRAND_BLUE_DARK_RGB, BRAND_BLUE_RGB, BRAND_INK, CANVAS_BG, CANVAS_BG_BOTTOM, CANVAS_BG_DARK, CANVAS_BG_TOP, CANVAS_BORDER_DARK, CANVAS_CARD_DARK, CANVAS_DOT_DARK, CANVAS_DOT_GRID, CANVAS_DOT_LIGHT, CANVAS_INK_DARK } from './canvas-brand-tokens.js'

/** Hairline border used on every floating chrome card (light). */
const CARD_BORDER = '#d9e2f2'
/** Shadow used on every floating chrome card (workbench blue-grey family). */
const CARD_SHADOW = '0px 1px 2px rgba(30, 42, 76, 0.06), 0px 4px 12px rgba(30, 42, 76, 0.08)'
const CARD_SHADOW_DARK = '0px 1px 2px rgba(0, 0, 0, 0.4), 0px 4px 14px rgba(0, 0, 0, 0.35)'

export const CANVAS_SKIN_CSS = `
/* ---------------------------------------------------------------
 * Surface: solid base + camera-locked dot grid. The editor canvas is
 * transparent (appState.viewBackgroundColor), so the dots show through
 * and pan/zoom with the scene via --ig-dot-* custom properties.
 * ------------------------------------------------------------- */
.dsh-ig-canvas-surface {
	--ig-dot-color: ${CANVAS_DOT_LIGHT};
	--ig-dot-size: ${CANVAS_DOT_GRID}px;
	--ig-dot-x: 0px;
	--ig-dot-y: 0px;
	--ig-dot-opacity: 1;
	background-color: ${CANVAS_BG};
	background-image: linear-gradient(180deg, ${CANVAS_BG_TOP} 0%, ${CANVAS_BG} 60%, ${CANVAS_BG_BOTTOM} 100%);
}
.dsh-ig-canvas-surface::before {
	content: '';
	position: absolute;
	inset: 0;
	pointer-events: none;
	background-image: radial-gradient(circle, var(--ig-dot-color) 1px, transparent 1.4px);
	background-size: var(--ig-dot-size) var(--ig-dot-size);
	background-position: var(--ig-dot-x) var(--ig-dot-y);
	opacity: var(--ig-dot-opacity);
}
body[data-ds-dark-theme] .dsh-ig-canvas-surface {
	--ig-dot-color: ${CANVAS_DOT_DARK};
	background-color: ${CANVAS_BG_DARK};
	background-image: none;
}

/* ---------------------------------------------------------------
 * Brand variables: light chrome (the plugin's default shell).
 * ------------------------------------------------------------- */
.dsh-ig-canvas-surface .excalidraw {
	background: transparent;
	--color-primary: ${BRAND_BLUE};
	--color-primary-darker: #2456d8;
	--color-primary-darkest: #1d47b8;
	--color-primary-light: #e3e9fd;
	--color-primary-light-darker: #d3ddfb;
	--color-primary-hover: #2456d8;
	--color-brand-hover: ${BRAND_BLUE};
	--color-selection: ${BRAND_BLUE};
	--focus-highlight-color: ${BRAND_BLUE};
	--link-color: ${BRAND_BLUE};
	--island-bg-color: #ffffff;
	--default-bg-color: ${CANVAS_BG};
	--input-bg-color: #ffffff;
	--input-border-color: ${CARD_BORDER};
	--input-hover-bg-color: #f4f7fd;
	--input-label-color: ${BRAND_INK};
	--text-primary-color: ${BRAND_INK};
	--icon-fill-color: #3c465e;
	--default-border-color: ${CARD_BORDER};
	--button-gray-1: #eef2fa;
	--button-gray-2: #e2e9f5;
	--button-gray-3: #d9e2f2;
	--button-special-active-bg-color: #e3e9fd;
	--popup-secondary-bg-color: #ffffff;
	--popup-text-color: ${BRAND_INK};
	--dialog-border-color: ${CARD_BORDER};
	--overlay-bg-color: rgba(30, 42, 76, 0.12);
	--shadow-island: ${CARD_SHADOW};
	--modal-shadow: ${CARD_SHADOW};
	--border-radius-lg: 12px;
	--keybinding-color: #6b7690;
	--scrollbar-thumb: #c6d2e6;
	--scrollbar-thumb-hover: #aebfd9;
	--color-slider-track: #d3ddfb;
	--color-slider-thumb: ${BRAND_BLUE};
	--color-surface-lowest: #ffffff;
	--color-surface-low: #f4f7fd;
	--color-surface-mid: #eef2fa;
	--color-surface-high: #e6ebf5;
	--list-border-color: ${CARD_BORDER};
	--ImageExportModal-preview-border: ${CARD_BORDER};
}
.dsh-ig-canvas-surface .excalidraw .layer-ui__wrapper { background: transparent; }

/* Dark chrome follows the editor theme class, which follows the DSH host. */
.dsh-ig-canvas-surface .excalidraw.theme--dark {
	--color-primary: ${BRAND_BLUE_DARK};
	--color-primary-darker: #7fa0fa;
	--color-primary-darkest: #9db6fb;
	--color-primary-light: #2a3550;
	--color-primary-light-darker: #232c44;
	--color-primary-hover: #7fa0fa;
	--color-brand-hover: ${BRAND_BLUE_DARK};
	--color-selection: ${BRAND_BLUE_DARK};
	--focus-highlight-color: ${BRAND_BLUE_DARK};
	--link-color: ${BRAND_BLUE_DARK};
	--island-bg-color: ${CANVAS_CARD_DARK};
	--default-bg-color: ${CANVAS_BG_DARK};
	--input-bg-color: #171b24;
	--input-border-color: ${CANVAS_BORDER_DARK};
	--input-hover-bg-color: ${CANVAS_CARD_DARK};
	--input-label-color: ${CANVAS_INK_DARK};
	--text-primary-color: ${CANVAS_INK_DARK};
	--icon-fill-color: #c3cbdc;
	--default-border-color: ${CANVAS_BORDER_DARK};
	--button-gray-1: #262c38;
	--button-gray-2: ${CANVAS_BORDER_DARK};
	--button-gray-3: #333c4e;
	--button-special-active-bg-color: #2a3550;
	--button-hover-bg: #262c38;
	--popup-secondary-bg-color: ${CANVAS_CARD_DARK};
	--popup-text-color: ${CANVAS_INK_DARK};
	--dialog-border-color: ${CANVAS_BORDER_DARK};
	--overlay-bg-color: rgba(0, 0, 0, 0.4);
	--shadow-island: ${CARD_SHADOW_DARK};
	--modal-shadow: ${CARD_SHADOW_DARK};
	--keybinding-color: #8b94a8;
	--scrollbar-thumb: #333c4e;
	--scrollbar-thumb-hover: #3d4759;
	--color-slider-track: #2a3550;
	--color-slider-thumb: ${BRAND_BLUE_DARK};
	--color-surface-lowest: #171b24;
	--color-surface-low: ${CANVAS_CARD_DARK};
	--color-surface-mid: #262c38;
	--color-surface-high: ${CANVAS_BORDER_DARK};
	--list-border-color: ${CANVAS_BORDER_DARK};
	--ImageExportModal-preview-border: ${CANVAS_BORDER_DARK};
}

/* ---------------------------------------------------------------
 * Composition: left tool strip, right style panel, bottom zoom.
 * ------------------------------------------------------------- */

/* Top-center toolbar island -> floating vertical card on the left edge. */
.dsh-ig-canvas-surface .excalidraw .App-top-bar {
	position: absolute;
	left: 12px;
	top: 50%;
	transform: translateY(-50%);
	width: auto;
	align-items: flex-start;
}
.dsh-ig-canvas-surface .excalidraw .App-top-bar .Island { border: 1px solid var(--default-border-color); }
.dsh-ig-canvas-surface .excalidraw .App-toolbar { width: auto; }
.dsh-ig-canvas-surface .excalidraw .App-toolbar-content {
	flex-direction: column;
	padding: 6px;
	gap: 2px;
}
.dsh-ig-canvas-surface .excalidraw .App-toolbar__divider {
	width: 1.5rem;
	height: 1px;
	margin: 0.25rem 0;
}
/* The overflow-tools dropdown opens beside the strip, not below it. */
.dsh-ig-canvas-surface .excalidraw .App-toolbar__extra-tools-dropdown {
	left: calc(100% + 8px);
	top: 0;
	right: auto;
	margin-top: 0;
}

/* Properties (color/stroke) panel -> floating card on the right edge. */
.dsh-ig-canvas-surface .excalidraw .App-menu__left {
	left: auto;
	right: 0;
	top: 0;
	max-height: 100%;
	background-color: var(--island-bg-color);
	border: 1px solid var(--default-border-color);
	border-radius: 12px;
	box-shadow: var(--shadow-island);
}

/* Bottom zoom/undo cluster -> bordered cards offset from the screen edge. */
.dsh-ig-canvas-surface .excalidraw .App-bottom-bar { --bar-padding: 12px; }
.dsh-ig-canvas-surface .excalidraw .zoom-actions,
.dsh-ig-canvas-surface .excalidraw .undo-redo-buttons {
	border: 1px solid var(--default-border-color);
	box-shadow: var(--shadow-island);
}

/* Dropdown menus, dialogs and popovers -> hairline border for definition. */
.dsh-ig-canvas-surface .excalidraw .dropdown-menu,
.dsh-ig-canvas-surface .excalidraw .Modal__content {
	border: 1px solid var(--default-border-color);
}

/* The stock welcome splash carries third-party branding; the workbench has
   its own one-time hint banner outside the editor. */
.dsh-ig-canvas-surface .excalidraw .welcome-screen-decor { display: none; }

/* Active tool feedback stays brand-tinted in both themes. */
.dsh-ig-canvas-surface .excalidraw .ToolIcon.active { --icon-fill-color: var(--color-primary); }
.dsh-ig-canvas-surface .excalidraw .App-toolbar .eraser.active { background-color: rgba(${BRAND_BLUE_RGB}, 0.16); }
.dsh-ig-canvas-surface .excalidraw.theme--dark .App-toolbar .eraser.active { background-color: rgba(${BRAND_BLUE_DARK_RGB}, 0.22); }
`
