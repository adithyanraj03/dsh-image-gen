/**
 * Regenerate src/client/canvas/canvas-css.ts from the installed Excalidraw
 * package (MIT). Run after upgrading @excalidraw/excalidraw:
 *
 *   node scripts/generate-excalidraw-css.mjs
 *
 * The plugin injects its styles as one <style> string (the host loads a
 * single client.js), so relative font URLs in the package CSS are embedded
 * as data URLs here. The large on-demand CJK subsets (Xiaolai) are not part
 * of this CSS; they resolve through Excalidraw's runtime asset loader.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const prodDir = join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod')
let css = await readFile(join(prodDir, 'index.css'), 'utf8')

const fontUrls = [...css.matchAll(/url\((["']?)(\.\/fonts\/[^)"']+)\1\)/g)]
for (const match of fontUrls) {
  const bytes = await readFile(join(prodDir, match[2]))
  const dataUrl = `data:font/woff2;base64,${bytes.toString('base64')}`
  css = css.split(match[0]).join(`url("${dataUrl}")`)
}

const banner = '/** Bundled Excalidraw styles (@excalidraw/excalidraw 0.18.1, MIT). Generated from dist/prod/index.css by scripts/generate-excalidraw-css.mjs - do not edit by hand. UI fonts are embedded as data URLs so the string can be injected as a <style> tag. */\n'
const target = join(root, 'src', 'client', 'canvas', 'canvas-css.ts')
await writeFile(target, `${banner}export const CANVAS_CSS: string = ${JSON.stringify(css)}\n`)
console.log(`[generate-excalidraw-css] wrote ${target} (${css.length} chars, ${fontUrls.length} embedded fonts)`)
