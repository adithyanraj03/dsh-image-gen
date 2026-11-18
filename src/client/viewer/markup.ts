/**
 * DRAW/Markup mode for the shared lightbox: freehand/shape/text marks stored in
 * IMAGE-NORMALIZED coordinates (0..1), a pure draw-plan builder, and the
 * browser-side PNG bake at natural resolution.
 *
 * Everything above `renderMarkupImage` is pure and node-safe (no DOM, canvas or
 * browser-only imports at module scope) so the geometry/scaling/numbering can
 * be unit-tested directly. The bake replays the same draw plan on a canvas at
 * the image's natural width/height, so preview and baked pixels agree.
 */
import type { CommitItem } from './annotations.js'

export type MarkupTool = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'step' | 'redact' | 'text'
export type MarkupStroke = 'S' | 'M' | 'L'
export interface MarkupPoint { x: number; y: number }
export interface MarkupShape {
  id: string
  tool: MarkupTool
  color: string
  stroke: MarkupStroke
  /** Normalized 0..1 points: pen = every sample; two-corner tools = [start, end]; step/text = [anchor]. */
  points: MarkupPoint[]
  text?: string
  step?: number
}
/** A baked marked PNG ready for the composer-draft commit. */
export interface MarkupCommitEntry {
  item: CommitItem
  blob: Blob
  /** Composer-origin save: replace the draft attachment matching `item.src`. */
  replace?: boolean | undefined
}
/** How a markup save landed in the draft (drives the lightbox toast). */
export type MarkupCommitOutcome = 'replaced' | 'added' | 'fallback'

export const MARKUP_COLORS = ['#3964fe', '#ff3b30', '#ffcc00', '#34c759', '#ffffff', '#111111'] as const
export const MARKUP_STROKES = ['S', 'M', 'L'] as const
/** Redact boxes are solid: fully opaque, never a translucent highlight. */
export const REDACT_OPACITY = 1

const STROKE_FACTORS: Record<MarkupStroke, number> = { S: 0.004, M: 0.008, L: 0.016 }

export interface ScreenRect { left: number; top: number; width: number; height: number }
export interface MarkupGeometry { width: number; height: number; stageWidth: number; stageHeight: number }
export interface MarkupTransform { zoom: number; x: number; y: number }

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * Screen rect of the transformed image, using the same math as the lightbox's
 * annotationPosition (stage center + transform.x/y, geometry × zoom). Kept pure
 * for tests; at runtime the lightbox measures the surface rect directly, which
 * is exact even with the stage's asymmetric padding.
 */
export function imageScreenRect(stage: ScreenRect, geometry: MarkupGeometry, transform: MarkupTransform): ScreenRect {
  const width = geometry.width * transform.zoom
  const height = geometry.height * transform.zoom
  return {
    left: stage.left + geometry.stageWidth / 2 + transform.x - width / 2,
    top: stage.top + geometry.stageHeight / 2 + transform.y - height / 2,
    width,
    height,
  }
}

/** Screen point → image-normalized point (clamped to the image). */
export function screenToNormalized(clientX: number, clientY: number, imageRect: ScreenRect): MarkupPoint {
  return {
    x: clamp01(imageRect.width > 0 ? (clientX - imageRect.left) / imageRect.width : 0.5),
    y: clamp01(imageRect.height > 0 ? (clientY - imageRect.top) / imageRect.height : 0.5),
  }
}

/** Image-normalized point → screen point (inverse of screenToNormalized). */
export function normalizedToScreen(point: MarkupPoint, imageRect: ScreenRect): MarkupPoint {
  return { x: imageRect.left + point.x * imageRect.width, y: imageRect.top + point.y * imageRect.height }
}

/** Stroke width in natural image pixels; scales with the image's short side. */
export function strokePixels(stroke: MarkupStroke, width: number, height: number): number {
  return Math.max(1.5, STROKE_FACTORS[stroke] * Math.min(width, height))
}
/** Numbered-step circle radius in natural pixels (mirrors the annotation pins). */
export function stepRadius(width: number, height: number): number {
  return Math.max(12, Math.min(width, height) / 50)
}
/** Text-tool font size in natural pixels, tied to the stroke-width selector. */
export function textFontSize(stroke: MarkupStroke, width: number, height: number): number {
  return strokePixels(stroke, width, height) * 5
}
/** Next auto-incrementing step number; undoing the last step reuses its number. */
export function nextStepNumber(shapes: MarkupShape[]): number {
  return shapes.reduce((max, shape) => shape.tool === 'step' ? Math.max(max, shape.step ?? 0) : max, 0) + 1
}
/** Ring/number color that stays readable on the chosen step fill. */
export function stepContrast(color: string): string {
  return color.toLowerCase() === '#ffffff' ? '#111111' : '#ffffff'
}

/** Filled arrowhead triangle: tip at `to`, base `size` pixels back along the shaft. */
export function arrowHeadPoints(from: MarkupPoint, to: MarkupPoint, size: number): MarkupPoint[] {
  const dx = to.x - from.x, dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length === 0 || size <= 0) return []
  const ux = dx / length, uy = dy / length
  const baseX = to.x - ux * size, baseY = to.y - uy * size
  const half = size * 0.5
  return [
    { x: to.x, y: to.y },
    { x: baseX - uy * half, y: baseY + ux * half },
    { x: baseX + uy * half, y: baseY - ux * half },
  ]
}

/** A draw op in NATURAL image pixels — the single source of truth for preview and bake. */
export type MarkupDrawOp =
  | { kind: 'dot'; x: number; y: number; radius: number; color: string }
  | { kind: 'polyline'; points: MarkupPoint[]; color: string; width: number }
  | { kind: 'line'; from: MarkupPoint; to: MarkupPoint; color: string; width: number }
  | { kind: 'arrow'; from: MarkupPoint; to: MarkupPoint; head: MarkupPoint[]; color: string; width: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string; width: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; color: string; width: number }
  | { kind: 'step'; cx: number; cy: number; radius: number; color: string; contrast: string; label: string; fontSize: number; ringWidth: number }
  | { kind: 'redact'; x: number; y: number; w: number; h: number; color: string; opacity: number }
  | { kind: 'text'; x: number; y: number; text: string; color: string; fontSize: number }

/** Scale normalized shapes to natural pixels and drop degenerate ones. */
export function buildMarkupOps(shapes: MarkupShape[], width: number, height: number): MarkupDrawOp[] {
  const ops: MarkupDrawOp[] = []
  for (const shape of shapes) {
    const points = shape.points.map(point => ({ x: point.x * width, y: point.y * height }))
    const lineWidth = strokePixels(shape.stroke, width, height)
    const first = points[0]
    const second = points[1]
    switch (shape.tool) {
      case 'pen': {
        if (!first) break
        if (points.length === 1) ops.push({ kind: 'dot', x: first.x, y: first.y, radius: lineWidth / 2, color: shape.color })
        else ops.push({ kind: 'polyline', points, color: shape.color, width: lineWidth })
        break
      }
      case 'line':
      case 'arrow': {
        if (!first || !second || (first.x === second.x && first.y === second.y)) break
        if (shape.tool === 'line') ops.push({ kind: 'line', from: first, to: second, color: shape.color, width: lineWidth })
        else ops.push({ kind: 'arrow', from: first, to: second, head: arrowHeadPoints(first, second, Math.max(8, lineWidth * 4)), color: shape.color, width: lineWidth })
        break
      }
      case 'rect':
      case 'redact': {
        if (!first || !second) break
        const x = Math.min(first.x, second.x), y = Math.min(first.y, second.y)
        const w = Math.abs(second.x - first.x), h = Math.abs(second.y - first.y)
        if (w <= 0 || h <= 0) break
        if (shape.tool === 'redact') ops.push({ kind: 'redact', x, y, w, h, color: shape.color, opacity: REDACT_OPACITY })
        else ops.push({ kind: 'rect', x, y, w, h, color: shape.color, width: lineWidth })
        break
      }
      case 'ellipse': {
        if (!first || !second) break
        const rx = Math.abs(second.x - first.x) / 2, ry = Math.abs(second.y - first.y) / 2
        if (rx <= 0 || ry <= 0) break
        ops.push({ kind: 'ellipse', cx: (first.x + second.x) / 2, cy: (first.y + second.y) / 2, rx, ry, color: shape.color, width: lineWidth })
        break
      }
      case 'step': {
        if (!first) break
        const radius = stepRadius(width, height)
        ops.push({ kind: 'step', cx: first.x, cy: first.y, radius, color: shape.color, contrast: stepContrast(shape.color), label: String(shape.step ?? 1), fontSize: radius, ringWidth: Math.max(2, radius / 7) })
        break
      }
      case 'text': {
        const text = shape.text?.trim()
        if (!first || !text) break
        ops.push({ kind: 'text', x: first.x, y: first.y, text, color: shape.color, fontSize: textFontSize(shape.stroke, width, height) })
        break
      }
    }
  }
  return ops
}

/** `<base>-marked.png` from the item name, mirroring the annotated-PNG naming. */
export function markedFileName(name: string | undefined): string {
  return `${String(name || 'image').replace(/\.[^.]+$/, '')}-marked.png`
}

/** Replay a draw plan on a 2D context (natural-pixel coordinates). */
export function drawMarkupOps(context: CanvasRenderingContext2D, ops: MarkupDrawOp[]): void {
  for (const op of ops) {
    context.save()
    context.lineCap = 'round'
    context.lineJoin = 'round'
    switch (op.kind) {
      case 'dot':
        context.beginPath()
        context.arc(op.x, op.y, op.radius, 0, Math.PI * 2)
        context.fillStyle = op.color
        context.fill()
        break
      case 'polyline':
        context.beginPath()
        op.points.forEach((point, index) => { if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y) })
        context.strokeStyle = op.color
        context.lineWidth = op.width
        context.stroke()
        break
      case 'line':
        context.beginPath()
        context.moveTo(op.from.x, op.from.y)
        context.lineTo(op.to.x, op.to.y)
        context.strokeStyle = op.color
        context.lineWidth = op.width
        context.stroke()
        break
      case 'arrow':
        context.beginPath()
        context.moveTo(op.from.x, op.from.y)
        context.lineTo(op.to.x, op.to.y)
        context.strokeStyle = op.color
        context.lineWidth = op.width
        context.stroke()
        if (op.head.length === 3) {
          context.beginPath()
          context.moveTo(op.head[0]!.x, op.head[0]!.y)
          context.lineTo(op.head[1]!.x, op.head[1]!.y)
          context.lineTo(op.head[2]!.x, op.head[2]!.y)
          context.closePath()
          context.fillStyle = op.color
          context.fill()
        }
        break
      case 'rect':
        context.strokeStyle = op.color
        context.lineWidth = op.width
        context.strokeRect(op.x, op.y, op.w, op.h)
        break
      case 'ellipse':
        context.beginPath()
        context.ellipse(op.cx, op.cy, op.rx, op.ry, 0, 0, Math.PI * 2)
        context.strokeStyle = op.color
        context.lineWidth = op.width
        context.stroke()
        break
      case 'step':
        context.beginPath()
        context.arc(op.cx, op.cy, op.radius, 0, Math.PI * 2)
        context.fillStyle = op.color
        context.fill()
        context.strokeStyle = op.contrast
        context.lineWidth = op.ringWidth
        context.stroke()
        context.fillStyle = op.contrast
        context.font = `700 ${op.fontSize}px sans-serif`
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(op.label, op.cx, op.cy)
        break
      case 'redact':
        context.globalAlpha = op.opacity
        context.fillStyle = op.color
        context.fillRect(op.x, op.y, op.w, op.h)
        break
      case 'text':
        context.fillStyle = op.color
        context.font = `600 ${op.fontSize}px sans-serif`
        context.textAlign = 'left'
        context.textBaseline = 'top'
        context.fillText(op.text, op.x, op.y)
        break
    }
    context.restore()
  }
}

/**
 * Bake marks into the ORIGINAL pixels: offscreen canvas at the image's natural
 * width/height, original image first, then every shape scaled to natural size,
 * exported as PNG. Same pattern as renderAnnotationImage.
 */
export async function renderMarkupImage(blob: Blob, shapes: MarkupShape[]): Promise<Blob> {
  const image = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.drawImage(image, 0, 0)
    drawMarkupOps(context, buildMarkupOps(shapes, image.width, image.height))
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed')), 'image/png'))
  } finally { image.close() }
}
