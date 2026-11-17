/**
 * Node-safe unit tests for the lightbox DRAW/Markup mode: screen<->normalized
 * mapping, shape scaling to natural pixels, step numbering, redact opacity,
 * and the session-pinned composer-draft commit shared with region notes.
 * Pure helpers only — no DOM/canvas/Excalidraw imports.
 */
import { describe, expect, it } from 'vitest'
import {
  MARKUP_COLORS, REDACT_OPACITY, arrowHeadPoints, buildMarkupOps, imageScreenRect,
  markedFileName, nextStepNumber, normalizedToScreen, screenToNormalized,
  stepContrast, stepRadius, strokePixels, textFontSize,
  type MarkupPoint, type MarkupShape, type MarkupTool,
} from '../src/client/viewer/markup.js'
import {
  captureDraftHost, commitDraftFiles, createDraftCommit,
  type ComposerInput, type ConversationLike, type SessionsLike,
} from '../src/client/viewer/annotations.js'

let seq = 0
function shape(tool: MarkupTool, points: MarkupPoint[], extra?: Partial<MarkupShape>): MarkupShape {
  seq += 1
  return { id: `shape-${seq}`, tool, color: '#ff3b30', stroke: 'M', points, ...extra }
}

const stage = { left: 100, top: 50, width: 800, height: 600 }
const geometry = { width: 400, height: 300, stageWidth: 800, stageHeight: 600 }

describe('markup screen <-> normalized mapping', () => {
  it('derives the image screen rect with the annotationPosition math at fit', () => {
    expect(imageScreenRect(stage, geometry, { zoom: 1, x: 0, y: 0 })).toEqual({ left: 300, top: 200, width: 400, height: 300 })
  })

  it('applies zoom and pan to the rect exactly like the surface transform', () => {
    expect(imageScreenRect(stage, geometry, { zoom: 2, x: 40, y: -30 })).toEqual({ left: 140, top: 20, width: 800, height: 600 })
  })

  it('matches the pin formula: stage-local center + (n - 0.5) * size * zoom', () => {
    const transform = { zoom: 1.8, x: 25, y: -12 }
    const rect = imageScreenRect(stage, geometry, transform)
    const annotation = { x: 0.3, y: 0.7 }
    const pinCenterX = geometry.stageWidth / 2 + transform.x + (annotation.x - 0.5) * geometry.width * transform.zoom
    const pinCenterY = geometry.stageHeight / 2 + transform.y + (annotation.y - 0.5) * geometry.height * transform.zoom
    const screen = normalizedToScreen(annotation, rect)
    expect(screen.x - stage.left).toBeCloseTo(pinCenterX, 10)
    expect(screen.y - stage.top).toBeCloseTo(pinCenterY, 10)
  })

  it('maps the image center and corners to 0.5 / 0 / 1', () => {
    const rect = imageScreenRect(stage, geometry, { zoom: 1, x: 0, y: 0 })
    expect(screenToNormalized(500, 350, rect)).toEqual({ x: 0.5, y: 0.5 })
    expect(screenToNormalized(300, 200, rect)).toEqual({ x: 0, y: 0 })
    expect(screenToNormalized(700, 500, rect)).toEqual({ x: 1, y: 1 })
  })

  it('round-trips under zoom + pan', () => {
    const rect = imageScreenRect(stage, geometry, { zoom: 2.5, x: -60, y: 35 })
    for (const point of [{ x: 0, y: 0 }, { x: 0.25, y: 0.75 }, { x: 1, y: 1 }, { x: 0.5, y: 0.5 }]) {
      const screen = normalizedToScreen(point, rect)
      const back = screenToNormalized(screen.x, screen.y, rect)
      expect(back.x).toBeCloseTo(point.x, 10)
      expect(back.y).toBeCloseTo(point.y, 10)
    }
  })

  it('clamps points outside the image to the 0..1 range', () => {
    const rect = imageScreenRect(stage, geometry, { zoom: 1, x: 0, y: 0 })
    expect(screenToNormalized(-500, -500, rect)).toEqual({ x: 0, y: 0 })
    expect(screenToNormalized(5000, 5000, rect)).toEqual({ x: 1, y: 1 })
  })

  it('falls back to the center for a zero-sized rect', () => {
    expect(screenToNormalized(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('markup shape scaling to natural pixels', () => {
  it('scales a rectangle and its stroke to the natural size', () => {
    const ops = buildMarkupOps([shape('rect', [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }])], 1000, 500)
    expect(ops).toEqual([{ kind: 'rect', x: 250, y: 125, w: 500, h: 250, color: '#ff3b30', width: 4 }])
  })

  it('normalizes a rectangle dragged bottom-right to top-left', () => {
    const ops = buildMarkupOps([shape('rect', [{ x: 0.75, y: 0.75 }, { x: 0.25, y: 0.25 }])], 1000, 500)
    expect(ops[0]).toMatchObject({ kind: 'rect', x: 250, y: 125, w: 500, h: 250 })
  })

  it('scales an ellipse to center + radii', () => {
    const ops = buildMarkupOps([shape('ellipse', [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }])], 1000, 500)
    expect(ops[0]).toMatchObject({ kind: 'ellipse', cx: 500, cy: 250, rx: 250, ry: 125, width: 4 })
  })

  it('scales line endpoints', () => {
    const ops = buildMarkupOps([shape('line', [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }])], 1000, 500)
    expect(ops[0]).toMatchObject({ kind: 'line', from: { x: 100, y: 50 }, to: { x: 900, y: 450 }, width: 4 })
  })

  it('builds an arrowhead with the tip at the end, scaled by stroke width', () => {
    const ops = buildMarkupOps([shape('arrow', [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], { stroke: 'L' })], 1000, 500)
    const op = ops[0]
    expect(op).toMatchObject({ kind: 'arrow', from: { x: 200, y: 250 }, to: { x: 800, y: 250 }, width: 8 })
    if (op?.kind !== 'arrow') throw new Error('expected arrow op')
    expect(op.head).toHaveLength(3)
    expect(op.head[0]).toEqual({ x: 800, y: 250 })
    // L stroke = 8px → head size max(8, 8*4) = 32, half-width 16.
    expect(op.head[1]).toEqual({ x: 768, y: 266 })
    expect(op.head[2]).toEqual({ x: 768, y: 234 })
  })

  it('arrowHeadPoints returns nothing for a zero-length direction', () => {
    expect(arrowHeadPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 10)).toEqual([])
  })

  it('keeps every pen sample, scaled; a single sample becomes a dot', () => {
    const points = [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }, { x: 0.5, y: 0.6 }]
    const ops = buildMarkupOps([shape('pen', points)], 1000, 500)
    expect(ops[0]).toEqual({ kind: 'polyline', points: [{ x: 100, y: 100 }, { x: 300, y: 200 }, { x: 500, y: 300 }], color: '#ff3b30', width: 4 })
    const dot = buildMarkupOps([shape('pen', [{ x: 0.5, y: 0.5 }])], 1000, 500)
    expect(dot[0]).toEqual({ kind: 'dot', x: 500, y: 250, radius: 2, color: '#ff3b30' })
  })

  it('scales step circles and keeps the stored number', () => {
    const ops = buildMarkupOps([shape('step', [{ x: 0.5, y: 0.5 }], { step: 3 })], 1000, 500)
    expect(ops[0]).toMatchObject({ kind: 'step', cx: 500, cy: 250, radius: stepRadius(1000, 500), label: '3', fontSize: stepRadius(1000, 500), contrast: '#ffffff' })
  })

  it('uses a dark ring/number on a white step so it stays readable', () => {
    expect(stepContrast('#ffffff')).toBe('#111111')
    expect(stepContrast('#FFFFFF')).toBe('#111111')
    expect(stepContrast('#3964fe')).toBe('#ffffff')
    const ops = buildMarkupOps([shape('step', [{ x: 0.5, y: 0.5 }], { color: '#ffffff', step: 1 })], 1000, 500)
    expect(ops[0]).toMatchObject({ kind: 'step', contrast: '#111111' })
  })

  it('scales text and trims it; empty text produces no op', () => {
    const ops = buildMarkupOps([shape('text', [{ x: 0.1, y: 0.2 }], { text: '  fix this  ' })], 1000, 500)
    expect(ops[0]).toEqual({ kind: 'text', x: 100, y: 100, text: 'fix this', color: '#ff3b30', fontSize: textFontSize('M', 1000, 500) })
    expect(buildMarkupOps([shape('text', [{ x: 0.1, y: 0.2 }], { text: '   ' })], 1000, 500)).toEqual([])
    expect(buildMarkupOps([shape('text', [{ x: 0.1, y: 0.2 }])], 1000, 500)).toEqual([])
  })

  it('drops degenerate shapes (zero-length lines/arrows, zero-area boxes)', () => {
    const same = [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }]
    expect(buildMarkupOps([shape('line', same)], 1000, 500)).toEqual([])
    expect(buildMarkupOps([shape('arrow', same)], 1000, 500)).toEqual([])
    expect(buildMarkupOps([shape('rect', same)], 1000, 500)).toEqual([])
    expect(buildMarkupOps([shape('redact', same)], 1000, 500)).toEqual([])
    expect(buildMarkupOps([shape('ellipse', same)], 1000, 500)).toEqual([])
    expect(buildMarkupOps([shape('pen', [])], 1000, 500)).toEqual([])
  })

  it('preserves shape order in the draw plan', () => {
    const ops = buildMarkupOps([
      shape('rect', [{ x: 0, y: 0 }, { x: 1, y: 1 }]),
      shape('step', [{ x: 0.5, y: 0.5 }], { step: 1 }),
      shape('redact', [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]),
    ], 1000, 500)
    expect(ops.map(op => op.kind)).toEqual(['rect', 'step', 'redact'])
  })
})

describe('markup stroke widths scale with image size', () => {
  it('S < M < L on the same image, proportional to the short side', () => {
    expect(strokePixels('S', 2000, 1000)).toBe(4)
    expect(strokePixels('M', 2000, 1000)).toBe(8)
    expect(strokePixels('L', 2000, 1000)).toBe(16)
  })

  it('clamps to a visible minimum on tiny images', () => {
    expect(strokePixels('S', 10, 10)).toBe(1.5)
    expect(strokePixels('L', 10, 10)).toBe(1.5)
  })

  it('text font size follows the stroke selector', () => {
    expect(textFontSize('S', 1000, 1000)).toBe(20)
    expect(textFontSize('M', 1000, 1000)).toBe(40)
    expect(textFontSize('L', 1000, 1000)).toBe(80)
  })

  it('step radius mirrors the annotation-pin sizing with a floor', () => {
    expect(stepRadius(3000, 2000)).toBe(40)
    expect(stepRadius(100, 100)).toBe(12)
  })
})

describe('markup redaction is solid', () => {
  it('bakes redact boxes fully opaque over the exact rectangle', () => {
    expect(REDACT_OPACITY).toBe(1)
    const ops = buildMarkupOps([shape('redact', [{ x: 0.2, y: 0.4 }, { x: 0.6, y: 0.8 }], { color: '#111111' })], 1000, 500)
    expect(ops).toEqual([{ kind: 'redact', x: 200, y: 200, w: 400, h: 200, color: '#111111', opacity: 1 }])
  })

  it('keeps redact distinct from the stroked (unfilled) rectangle', () => {
    const points = [{ x: 0.2, y: 0.4 }, { x: 0.6, y: 0.8 }]
    const redact = buildMarkupOps([shape('redact', points)], 1000, 500)[0]
    const rect = buildMarkupOps([shape('rect', points)], 1000, 500)[0]
    expect(redact?.kind).toBe('redact')
    expect(rect?.kind).toBe('rect')
    expect(redact).not.toHaveProperty('width')
  })
})

describe('markup step auto-numbering', () => {
  it('starts at 1 and ignores non-step shapes', () => {
    expect(nextStepNumber([])).toBe(1)
    expect(nextStepNumber([shape('pen', [{ x: 0, y: 0 }]), shape('text', [{ x: 0, y: 0 }], { text: 'x' })])).toBe(1)
  })

  it('increments past the highest existing step', () => {
    const shapes = [shape('step', [{ x: 0, y: 0 }], { step: 1 }), shape('pen', [{ x: 0, y: 0 }]), shape('step', [{ x: 0, y: 0 }], { step: 2 })]
    expect(nextStepNumber(shapes)).toBe(3)
  })

  it('reuses the number after undoing the last step', () => {
    const shapes = [shape('step', [{ x: 0, y: 0 }], { step: 1 }), shape('step', [{ x: 0, y: 0 }], { step: 2 })]
    expect(nextStepNumber(shapes.slice(0, -1))).toBe(2)
  })
})

describe('marked PNG naming', () => {
  it('strips the extension and appends -marked.png', () => {
    expect(markedFileName('photo.jpg')).toBe('photo-marked.png')
    expect(markedFileName('a.b.png')).toBe('a.b-marked.png')
    expect(markedFileName('render')).toBe('render-marked.png')
  })

  it('falls back to image for empty or missing names', () => {
    expect(markedFileName('')).toBe('image-marked.png')
    expect(markedFileName(undefined)).toBe('image-marked.png')
  })

  it('offers brand blue plus red/white/black swatches', () => {
    expect(MARKUP_COLORS).toContain('#3964fe')
    expect(MARKUP_COLORS).toContain('#ff3b30')
    expect(MARKUP_COLORS).toContain('#ffffff')
    expect(MARKUP_COLORS).toContain('#111111')
  })
})

/** Fake sessions/conversation host exercising the shared draft-commit core. */
function hostHarness(options?: { phase?: string; occurrences?: unknown[]; addResult?: boolean; addThrows?: boolean; legacy?: boolean; draft?: string }) {
  const state = { current: 'session-1', phase: options?.phase ?? 'plain', occurrences: options?.occurrences ?? [] as unknown[], draft: options?.draft ?? '' }
  const added: string[][] = []
  const released: { id: string }[][] = []
  const drafts: string[] = []
  const createdFiles: File[][] = []
  const sessions: SessionsLike = { list: { getSnapshot: () => ({ current: state.current }) }, scope: id => ({ scopeId: id }) }
  const input: ComposerInput = {
    state: { getSnapshot: () => ({ phase: state.phase, occurrences: state.occurrences, draft: state.draft }) },
    setDraft: text => { drafts.push(text); state.draft = text },
  }
  const add = (ids: string[]): boolean => {
    added.push(ids)
    if (options?.addThrows) throw new Error('composer exploded')
    return options?.addResult ?? true
  }
  const conversation: ConversationLike = { input: { for: () => input } }
  if (options?.legacy) {
    input.addImages = add
    conversation.createDraftImages = files => { createdFiles.push(files); return files.map((_, index) => ({ id: `img-${index}` })) }
    conversation.releaseDraftImages = batch => { released.push(batch) }
  } else {
    input.addAttachments = add
    conversation.createDrafts = (_sessionId, files) => { createdFiles.push(files); return files.map((_, index) => ({ id: `draft-${index}` })) }
    conversation.releaseDraftAttachments = batch => { released.push(batch) }
  }
  const host = captureDraftHost({ getSessions: () => sessions, getConversation: () => conversation })
  return { host, state, added, released, drafts, createdFiles }
}

const markedFile = (): { file: File; text: string } => ({
  file: new File([new Blob(['png-bytes'], { type: 'image/png' })], 'photo-marked.png', { type: 'image/png' }),
  text: 'photo-marked.png',
})

describe('markup draft commit (shared session-pinned core)', () => {
  it('attaches the marked PNG and appends draft text without sending', async () => {
    const harness = hostHarness({ draft: 'existing draft' })
    await commitDraftFiles(harness.host, [markedFile()])
    expect(harness.createdFiles[0]?.[0]?.name).toBe('photo-marked.png')
    expect(harness.added).toEqual([['draft-0']])
    expect(harness.drafts).toEqual(['existing draft\n\nphoto-marked.png'])
    expect(harness.released).toEqual([])
  })

  it('refuses when the session changed since capture', async () => {
    const harness = hostHarness()
    harness.state.current = 'session-2'
    await expect(commitDraftFiles(harness.host, [markedFile()])).rejects.toThrow(/session changed/i)
    expect(harness.added).toEqual([])
  })

  it('refuses while the composer is busy or holds references', async () => {
    const busy = hostHarness({ phase: 'streaming' })
    await expect(commitDraftFiles(busy.host, [markedFile()])).rejects.toThrow(/busy/i)
    const refs = hostHarness({ occurrences: [{ kind: 'mention' }] })
    await expect(commitDraftFiles(refs.host, [markedFile()])).rejects.toThrow(/busy|references/i)
  })

  it('releases created drafts when the composer refuses the add', async () => {
    const harness = hostHarness({ addResult: false })
    await expect(commitDraftFiles(harness.host, [markedFile()])).rejects.toThrow(/busy/i)
    expect(harness.released).toEqual([[{ id: 'draft-0' }]])
    expect(harness.drafts).toEqual([])
  })

  it('releases created drafts when the add throws', async () => {
    const harness = hostHarness({ addThrows: true })
    await expect(commitDraftFiles(harness.host, [markedFile()])).rejects.toThrow(/exploded/)
    expect(harness.released).toEqual([[{ id: 'draft-0' }]])
  })

  it('falls back to the legacy draft-images API', async () => {
    const harness = hostHarness({ legacy: true })
    await commitDraftFiles(harness.host, [markedFile()])
    expect(harness.added).toEqual([['img-0']])
    expect(harness.drafts).toEqual(['photo-marked.png'])
  })

  it('refuses without a conversation host and does nothing for empty entries', async () => {
    const orphan = captureDraftHost({ getSessions: () => undefined, getConversation: () => undefined })
    await expect(commitDraftFiles(orphan, [markedFile()])).rejects.toThrow(/unavailable/i)
    const harness = hostHarness()
    await commitDraftFiles(harness.host, [])
    expect(harness.added).toEqual([])
    expect(harness.drafts).toEqual([])
  })

  it('createDraftCommit still bakes annotated PNGs and fast-fails on a stale session', async () => {
    const harness = hostHarness()
    let renders = 0
    const commit = createDraftCommit({
      getSessions: () => harness.host.sessions,
      getConversation: () => harness.host.conversation,
      readBlob: async () => new Blob(['original'], { type: 'image/png' }),
      formatNotes: () => 'Region 1 (50%, 50%): fix this',
      render: async () => { renders += 1; return new Blob(['annotated'], { type: 'image/png' }) },
    })
    await commit([{ item: { src: 'photo.png', name: 'photo.jpg' }, annotations: [{ id: 'a', x: 0.5, y: 0.5, note: 'fix this' }] }])
    expect(renders).toBe(1)
    expect(harness.createdFiles[0]?.[0]?.name).toBe('photo-annotated.png')
    expect(harness.drafts[0]).toContain('photo-annotated.png')
    expect(harness.drafts[0]).toContain('Region 1 (50%, 50%): fix this')

    harness.state.current = 'session-2'
    await expect(commit([{ item: { src: 'photo.png', name: 'photo.jpg' }, annotations: [] }])).rejects.toThrow(/session changed|unavailable/i)
    expect(renders).toBe(1)
  })
})
