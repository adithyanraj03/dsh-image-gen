/**
 * Interactive-stage styles for the ported viewer.
 *
 * Namespaced `igv-` so they cannot collide with the still-installed
 * dsh-image-viewer's global `.niv-*` rules. The surrounding chrome reuses the
 * existing `dsh-ig-lightbox-*` classes; only the zoom/pan stage, pins, inline
 * notes and zoom bar are new.
 */
export const VIEWER_CSS = String.raw`
.igv-root{cursor:default}
.igv-stage{position:absolute;inset:0;display:grid;place-items:center;min-width:0;min-height:0;overflow:hidden;padding:64px 24px 104px;box-sizing:border-box;touch-action:none;user-select:none}
.igv-stage[data-dragging=true]{cursor:grabbing}
.igv-stage[data-annotating=true]{cursor:crosshair}
.igv-surface{position:relative;display:inline-flex;max-width:100%;max-height:100%;transform-origin:center;will-change:transform}
.igv-image{display:block;max-width:calc(100vw - 72px);max-height:calc(100vh - 190px);border-radius:8px;object-fit:contain;box-shadow:0 24px 60px rgba(0,0,0,.7);user-select:none;-webkit-user-drag:none}
.igv-load-status{position:absolute;z-index:7;display:flex;align-items:center;gap:12px;color:#fff;font-size:14px}
.igv-zoombar{position:absolute;top:20px;left:50%;transform:translateX(-50%);z-index:11;display:flex;align-items:center;gap:2px;padding:4px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(28,30,34,.86);box-shadow:0 10px 30px rgba(0,0,0,.35);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);max-width:calc(100vw - 200px);overflow-x:auto;scrollbar-width:none}
.igv-zoombar::-webkit-scrollbar{display:none}
.igv-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:30px;padding:0 9px;border:0;border-radius:999px;background:transparent;color:rgba(255,255,255,.9);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
.igv-btn:hover,.igv-btn[data-active=true]{background:rgba(255,255,255,.14)}
.igv-btn:disabled{opacity:.38;cursor:default}
.igv-btn:focus-visible{outline:2px solid rgba(255,255,255,.9);outline-offset:2px}
.igv-zoom{min-width:46px;color:rgba(255,255,255,.7);font-size:12px;font-variant-numeric:tabular-nums;text-align:center}
.igv-annotation{position:absolute;z-index:6;width:24px;height:24px;pointer-events:none}
.igv-pin{position:absolute;inset:0;display:grid;place-items:center;width:24px;height:24px;padding:0;border:2px solid #fff;border-radius:50%;background:rgba(23,24,27,.94);box-shadow:0 4px 16px rgba(0,0,0,.35);color:#fff;font:inherit;font-size:11px;font-weight:700;cursor:pointer;pointer-events:auto}
.igv-pin[data-active=true]{background:var(--dsw-alias-state-business-primary,#3964fe)}
.igv-inline-note{position:absolute;bottom:34px;box-sizing:border-box;display:grid;width:min(300px,calc(100vw - 40px));grid-template-columns:24px minmax(0,1fr) 24px;align-items:center;gap:7px;padding:7px 8px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(32,33,37,.94);box-shadow:0 14px 38px rgba(0,0,0,.38);color:#fff;pointer-events:auto;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
.igv-annotation[data-x=right] .igv-inline-note{left:-8px}
.igv-annotation[data-x=left] .igv-inline-note{right:-8px}
.igv-annotation[data-x=center] .igv-inline-note{left:50%;transform:translateX(-50%)}
.igv-annotation[data-y=down] .igv-inline-note{top:34px;bottom:auto}
.igv-inline-index{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#3964fe);color:#fff;font-size:10px;font-weight:700}
.igv-inline-note textarea{box-sizing:border-box;width:100%;min-height:24px;max-height:92px;resize:none;overflow:auto;border:0;outline:0;background:transparent;color:#fff;font:inherit;font-size:12px;line-height:18px}
.igv-inline-note textarea::placeholder{color:rgba(255,255,255,.44)}
.igv-note-remove{display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:50%;background:transparent;color:rgba(255,255,255,.68);cursor:pointer}
.igv-note-remove:hover{background:rgba(255,255,255,.1);color:#fff}
.igv-hint{position:absolute;bottom:96px;left:50%;transform:translateX(-50%);z-index:6;color:rgba(255,255,255,.6);font-size:11.5px;pointer-events:none}
.igv-draft-status{position:absolute;top:64px;left:50%;transform:translateX(-50%);z-index:12;max-width:calc(100% - 48px);padding:10px 16px;border-radius:12px;background:#26272a;color:#fff;font-size:13px;line-height:20px;display:flex;align-items:center;gap:12px}
.igv-stage[data-markup=true]{cursor:crosshair}
.igv-surface[data-markup=true]{cursor:crosshair;touch-action:none}
.igv-markup-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.igv-markup-palette{position:absolute;top:62px;left:50%;transform:translateX(-50%);z-index:11;display:flex;align-items:center;gap:2px;padding:4px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(28,30,34,.9);box-shadow:0 10px 30px rgba(0,0,0,.35);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);max-width:calc(100vw - 32px);overflow-x:auto;scrollbar-width:none}
.igv-markup-palette::-webkit-scrollbar{display:none}
.igv-markup-group{display:flex;align-items:center;gap:2px;flex:none}
.igv-markup-sep{width:1px;height:20px;margin:0 4px;background:rgba(255,255,255,.16);flex:none}
.igv-markup-tool{width:30px;padding:0;flex:none}
.igv-swatch{box-sizing:border-box;width:20px;height:20px;padding:0;border:2px solid transparent;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.28);cursor:pointer;flex:none}
.igv-swatch[data-active=true]{border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.35)}
.igv-swatch:disabled{opacity:.38;cursor:default}
.igv-swatch:focus-visible{outline:2px solid rgba(255,255,255,.9);outline-offset:2px}
.igv-stroke-dot{display:block;border-radius:50%;background:currentColor}
.igv-stroke-dot[data-size=S]{width:4px;height:4px}
.igv-stroke-dot[data-size=M]{width:7px;height:7px}
.igv-stroke-dot[data-size=L]{width:11px;height:11px}
.igv-markup-save{background:var(--dsw-alias-state-business-primary,#3964fe);color:#fff}
.igv-markup-save:hover:not(:disabled){background:var(--dsw-alias-state-business-primary,#3964fe);filter:brightness(1.12)}
.igv-markup-notice{background:rgba(38,39,42,.96)}
@media(max-width:760px){.igv-stage{padding:56px 12px 96px}.igv-image{max-width:calc(100vw - 24px);max-height:calc(100vh - 168px)}.igv-zoombar{max-width:calc(100vw - 120px)}.igv-btn span.igv-label{display:none}.igv-inline-note{width:min(260px,calc(100vw - 40px))}.igv-markup-palette{top:56px;max-width:calc(100vw - 16px)}.igv-markup-palette .igv-label{display:none}}
@media(prefers-reduced-motion:reduce){.igv-surface{transition:none}}
`
