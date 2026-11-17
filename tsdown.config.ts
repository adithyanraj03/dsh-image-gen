/** Standalone host and browser bundle outputs. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)))

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  // The host ModuleLoader provides react-dom (18.3.1) alongside react; keep
  // both external so Excalidraw shares the host's single React instance.
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
]

/**
 * Excalidraw loads its handwriting/UI fonts from relative "./fonts/*.woff2"
 * URLs at runtime. The plugin ships as one bundled client.js with no adjacent
 * asset directory, so embed the small font families as data URLs at build
 * time. The CJK family (Xiaolai, 200+ on-demand subsets, ~12MB) is left to
 * Excalidraw's asset resolver (window.EXCALIDRAW_ASSET_PATH / CDN fallback,
 * then system fonts) — embedding it would multiply the bundle size.
 */
const require = createRequire(import.meta.url)
const excalidrawEntry = require.resolve('@excalidraw/excalidraw')
const excalidrawProdDir = dirname(excalidrawEntry)
// nanoid's CJS entry require()s node:crypto; resolve its browser ESM build
// (globalThis.crypto) through Excalidraw's dependency tree instead.
const nanoidDir = dirname(createRequire(excalidrawEntry).resolve('nanoid'))
const fontDataUrls = new Map<string, string>()
const excalidrawFontsPlugin = {
  name: 'dsh-image-gen:excalidraw-fonts',
  transform(code: string, id: string) {
    if (!id.includes('@excalidraw') || !code.includes('./fonts/')) return null
    const transformed = code.replace(/"\.\/fonts\/(?!Xiaolai\/)[^"]+\.woff2"/g, literal => {
      const relative = literal.slice(1, -1)
      let dataUrl = fontDataUrls.get(relative)
      if (dataUrl === undefined) {
        const bytes = readFileSync(join(excalidrawProdDir, relative))
        dataUrl = `data:font/woff2;base64,${bytes.toString('base64')}`
        fontDataUrls.set(relative, dataUrl)
      }
      return JSON.stringify(dataUrl)
    })
    return transformed === code ? null : { code: transformed, map: null }
  },
}

const host: UserConfig = {
  name: 'dsh-image-gen',
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

const client: UserConfig = {
  name: 'dsh-image-gen/client',
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: CLIENT_EXTERNALS,
  noExternal: (id: string) => CLIENT_EXTERNALS.includes(id) ? undefined : true,
  plugins: [excalidrawFontsPlugin],
  // The host webview has no `process` global; CJS deps (e.g. zustand via the
  // client runtime) read NODE_ENV at runtime, so bake it in at build time.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    // CJS output would otherwise shim import.meta.url with require("url"),
    // a node builtin the host ModuleLoader cannot resolve. The page URL is
    // the browser-correct base; Excalidraw's font-subset worker pool treats
    // a same-page worker URL as "no worker" and falls back to the main thread.
    'import.meta.url': 'document.baseURI',
    // Baked at build time; the canvas logs it so stale host caches are provable.
    __CANVAS_BUILD_TS__: JSON.stringify(new Date().toISOString()),
  },
  alias: {
    'lucide-react': 'lucide-react/dist/esm/lucide-react.mjs',
    'nanoid': join(nanoidDir, 'index.browser.js'),
    // AI diagram features are disabled on the workbench canvas; stub the
    // lazy mermaid renderer so it never enters the single-file bundle.
    '@excalidraw/mermaid-to-excalidraw': join(repoRoot, 'scripts/excalidraw-mermaid-stub.mjs'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    // The host loads exactly one client.js through its ModuleLoader; every
    // Excalidraw lazy chunk (locales, font-subset wasm, image helpers) must
    // inline instead of becoming sibling files the loader cannot resolve.
    inlineDynamicImports: true,
    banner: 'window.__ModuleLoader__.load({ id: "dsh-image-gen", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [host, client]
