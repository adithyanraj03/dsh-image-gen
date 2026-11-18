/**
 * Shared fullscreen image lightbox: ported viewer core (pointer-anchored zoom,
 * bounded pan, pinch, double-click 100%, keyboard, focus trap) + region
 * annotations + annotated-PNG → composer-draft commit + an actions slot.
 *
 * Ported from dsh-image-viewer@0.1.20 (WSL043, MIT) src/client.jsx, adapted to
 * dsh-image-gen's chrome (`dsh-ig-lightbox-*`), lucide icons and dict-based i18n.
 * Both the gallery preview and the studio fullscreen modal render this; the
 * public `imageGenViewer.open()` service mounts it as a standalone overlay.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Circle, Copy, Download, EyeOff, ListOrdered, Maximize, Minus, MoveUpRight, Pen, PenLine, PenTool, Save, Square, Trash2, Type, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useImageTransform } from './use-image-transform.js'
import { renderAnnotationImage, type Annotation, type CommitEntry } from './annotations.js'
import { buildMarkupOps, MARKUP_COLORS, MARKUP_STROKES, markedFileName, nextStepNumber, renderMarkupImage, screenToNormalized, type MarkupCommitEntry, type MarkupCommitOutcome, type MarkupDrawOp, type MarkupPoint, type MarkupShape, type MarkupStroke, type MarkupTool } from './markup.js'
import { copyImageBlob, downloadBlobUrl } from '../browser-image-utils.js'
import type { ImageViewerService, ViewerAction, ViewerItem } from './viewer-service.js'

export const VIEWER_KEYS = [
  'igvDialog', 'igvClose', 'igvFit', 'igvActual', 'igvAnnotate', 'igvCancelAnnotate',
  'igvRegions', 'igvRegionHint', 'igvNote', 'igvNotePlaceholder', 'igvRemoveNote',
  'igvCopyNotes', 'igvCopied', 'igvCopyFailed', 'igvPrevious', 'igvNext', 'igvZoomHint',
  'igvLoading', 'igvLoadFailed', 'igvRetry', 'igvAddingDraft', 'igvDraftFailed', 'igvCloseWithoutDraft',
  'igvMarkup', 'igvCancelMarkup', 'igvMarkupHint',
  'igvToolPen', 'igvToolLine', 'igvToolArrow', 'igvToolRect', 'igvToolEllipse', 'igvToolStep', 'igvToolRedact', 'igvToolText',
  'igvMarkupColor', 'igvMarkupStroke', 'igvStrokeS', 'igvStrokeM', 'igvStrokeL',
  'igvMarkupUndo', 'igvMarkupClear', 'igvMarkupSave', 'igvMarkupSaveHint',
  'igvMarkupCopy', 'igvMarkupDownload', 'igvMarkupDownloaded', 'igvMarkupSaved', 'igvMarkupNoHost', 'igvMarkupBakeFailed', 'igvMarkupTextPrompt',
  'igvMarkupReplaced', 'igvMarkupAddedFallback',
] as const
export type ViewerKey = typeof VIEWER_KEYS[number]
export type ViewerT = (key: ViewerKey, values?: Record<string, string>) => string

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const fill = (value: string, variables: Record<string, string>): string =>
  Object.entries(variables).reduce((text, [key, replacement]) => text.replaceAll(`{${key}}`, replacement), value)

export function noteText(annotations: Annotation[], t: ViewerT): string {
  return annotations.map((annotation, index) => {
    const label = fill(t('igvNote'), { value: String(index + 1) })
    return `${label} (${Math.round(annotation.x * 100)}%, ${Math.round(annotation.y * 100)}%): ${annotation.note.trim()}`
  }).filter(line => !line.endsWith(': ')).join('\n')
}

const MARKUP_TOOLS: { tool: MarkupTool; key: ViewerKey; Icon: typeof Pen }[] = [
  { tool: 'pen', key: 'igvToolPen', Icon: Pen },
  { tool: 'line', key: 'igvToolLine', Icon: Minus },
  { tool: 'arrow', key: 'igvToolArrow', Icon: MoveUpRight },
  { tool: 'rect', key: 'igvToolRect', Icon: Square },
  { tool: 'ellipse', key: 'igvToolEllipse', Icon: Circle },
  { tool: 'step', key: 'igvToolStep', Icon: ListOrdered },
  { tool: 'redact', key: 'igvToolRedact', Icon: EyeOff },
  { tool: 'text', key: 'igvToolText', Icon: Type },
]

/** SVG element for one natural-pixel draw op (mirrors drawMarkupOps on canvas). */
function MarkupOpElement({ op }: { op: MarkupDrawOp }) {
  switch (op.kind) {
    case 'dot':
      return <circle cx={op.x} cy={op.y} r={op.radius} fill={op.color} />
    case 'polyline':
      return <polyline points={op.points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={op.color} strokeWidth={op.width} strokeLinecap="round" strokeLinejoin="round" />
    case 'line':
      return <line x1={op.from.x} y1={op.from.y} x2={op.to.x} y2={op.to.y} stroke={op.color} strokeWidth={op.width} strokeLinecap="round" />
    case 'arrow':
      return <g><line x1={op.from.x} y1={op.from.y} x2={op.to.x} y2={op.to.y} stroke={op.color} strokeWidth={op.width} strokeLinecap="round" /><polygon points={op.head.map(point => `${point.x},${point.y}`).join(' ')} fill={op.color} /></g>
    case 'rect':
      return <rect x={op.x} y={op.y} width={op.w} height={op.h} fill="none" stroke={op.color} strokeWidth={op.width} />
    case 'ellipse':
      return <ellipse cx={op.cx} cy={op.cy} rx={op.rx} ry={op.ry} fill="none" stroke={op.color} strokeWidth={op.width} />
    case 'step':
      return <g><circle cx={op.cx} cy={op.cy} r={op.radius} fill={op.color} stroke={op.contrast} strokeWidth={op.ringWidth} /><text x={op.cx} y={op.cy} fill={op.contrast} fontSize={op.fontSize} fontWeight={700} fontFamily="sans-serif" textAnchor="middle" dominantBaseline="central">{op.label}</text></g>
    case 'redact':
      return <rect x={op.x} y={op.y} width={op.w} height={op.h} fill={op.color} fillOpacity={op.opacity} />
    case 'text':
      return <text x={op.x} y={op.y} fill={op.color} fontSize={op.fontSize} fontWeight={600} fontFamily="sans-serif" dominantBaseline="hanging">{op.text}</text>
  }
}

/**
 * Drawing overlay: a child of the transformed surface, so it sits EXACTLY over
 * the image at any zoom/pan. The viewBox is the image's natural pixel size and
 * shapes are the same draw plan the bake replays — preview == baked pixels.
 */
function MarkupOverlay({ shapes, draft, width, height }: { shapes: MarkupShape[]; draft: MarkupShape | undefined; width: number; height: number }) {
  const ops = buildMarkupOps(draft !== undefined ? [...shapes, draft] : shapes, width, height)
  return (
    <svg className="igv-markup-overlay" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {ops.map((op, index) => <MarkupOpElement key={index} op={op} />)}
    </svg>
  )
}

export interface ImageLightboxProps {
  items: ViewerItem[]
  index: number
  onIndex(next: number): void
  onClose(): void
  t: ViewerT
  service?: ImageViewerService | undefined
  topMeta?: ReactNode
  prompt?: string | undefined
  actions?: ReactNode
  viewerActions?: ViewerAction[] | undefined
  hasPrev?: boolean | undefined
  hasNext?: boolean | undefined
  onPrev?(): void
  onNext?(): void
  commitAnnotations?: ((entries: CommitEntry[]) => Promise<void>) | undefined
  /** Markup save: attach baked marked PNGs to the composer draft (no send). */
  commitMarkup?: ((entries: MarkupCommitEntry[]) => Promise<void | MarkupCommitOutcome>) | undefined
  /** Composer-origin preview: Markup Save replaces the draft attachment matching item.src. */
  draftReplace?: boolean | undefined
  onImageError?(item: ViewerItem, currentSrc: string): void
  loading?: boolean | undefined
}

function GenericAction({ action, annotations, item, onDone }: { action: ViewerAction; annotations: Annotation[]; item: ViewerItem; onDone(close: boolean): void }) {
  const [state, setState] = useState<'idle' | 'pending' | 'failed'>('idle')
  const invoke = async (): Promise<void> => {
    if (state === 'pending') return
    setState('pending')
    try {
      await action.onInvoke({ annotations, item, src: item.src })
      setState('idle')
      onDone(action.closeOnSuccess === true)
    } catch { setState('failed') }
  }
  const label = state === 'pending' ? (action.pendingLabel ?? action.label) : state === 'failed' ? (action.errorLabel ?? action.label) : action.label
  return <button type="button" className="igv-btn" disabled={state === 'pending'} onClick={() => { void invoke() }}><span className="igv-label">{label}</span></button>
}

export function ImageLightbox(props: ImageLightboxProps) {
  const { items, index, onIndex, onClose, t, service, topMeta, prompt, actions, viewerActions, commitAnnotations, commitMarkup, onImageError } = props
  const item = items[index]
  const identity = `${item?.id ?? ''}:${item?.src ?? ''}`
  const [markup, setMarkup] = useState(false)
  const { transform, transformRef, dragging, pixelScale, geometry, stageRef, surfaceRef, imageRef, fit, actual, measure, setZoomAt, resetGesture, pointerHandlers } = useImageTransform(identity, !markup)

  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [annotating, setAnnotating] = useState(false)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [focusNote, setFocusNote] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState(false)
  const [annotationsByImage, setAnnotationsByImage] = useState<Record<string, Annotation[]>>(() => service?.getAnnotationsSnapshot() ?? {})
  const annotationsRef = useRef(annotationsByImage)
  annotationsRef.current = annotationsByImage
  const openingRef = useRef<Record<string, string>>({})
  const rootRef = useRef<HTMLDivElement | null>(null)
  const committingRef = useRef(false)
  committingRef.current = committing

  // Markup mode: shapes live in image-normalized coordinates for this viewing
  // session only; Save bakes them into a PNG, Exit/Escape discards them.
  const [markupTool, setMarkupTool] = useState<MarkupTool>('pen')
  const [markupColor, setMarkupColor] = useState<string>('#ff3b30')
  const [markupStroke, setMarkupStroke] = useState<MarkupStroke>('M')
  const [markupShapes, setMarkupShapes] = useState<MarkupShape[]>([])
  const [markupDraft, setMarkupDraft] = useState<MarkupShape | undefined>(undefined)
  const [markupNotice, setMarkupNotice] = useState<string | undefined>(undefined)
  const markupRef = useRef(markup)
  markupRef.current = markup
  const markupShapesRef = useRef(markupShapes)
  markupShapesRef.current = markupShapes
  const markupDraftRef = useRef(markupDraft)
  const drawingPointerRef = useRef<number | undefined>(undefined)
  const noticeTimerRef = useRef<number | undefined>(undefined)
  const updateMarkupDraft = useCallback((next: MarkupShape | undefined): void => {
    markupDraftRef.current = next
    setMarkupDraft(next)
  }, [])
  const notifyMarkup = useCallback((message: string): void => {
    setMarkupNotice(message)
    if (noticeTimerRef.current !== undefined) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => { setMarkupNotice(undefined); noticeTimerRef.current = undefined }, 2600)
  }, [])
  useEffect(() => () => { if (noticeTimerRef.current !== undefined) window.clearTimeout(noticeTimerRef.current) }, [])
  const exitMarkup = useCallback((): void => {
    setMarkup(false); setMarkupShapes([]); updateMarkupDraft(undefined)
    drawingPointerRef.current = undefined
    resetGesture()
    rootRef.current?.focus()
  }, [resetGesture, updateMarkupDraft])

  // Capture the opening annotation state once per mount for change detection.
  useEffect(() => {
    const snapshot = service?.getAnnotationsSnapshot() ?? {}
    openingRef.current = Object.fromEntries(Object.entries(snapshot).map(([id, list]) => [id, JSON.stringify(list)]))
  }, [])

  useEffect(() => {
    setAnnotating(false); setSelected(undefined); setCopied(false); setCopyFailed(false)
    setMarkup(false); setMarkupShapes([]); updateMarkupDraft(undefined); setMarkupNotice(undefined)
    drawingPointerRef.current = undefined
    setImageState(props.loading ? 'loading' : 'loading'); setAttempt(0)
  }, [identity, updateMarkupDraft])

  const annotations = item ? (annotationsByImage[item.id] ?? []) : []
  const setAnnotations = useCallback((update: Annotation[] | ((prev: Annotation[]) => Annotation[])) => {
    if (committingRef.current || !item) return
    const previous = annotationsRef.current[item.id] ?? []
    const next = typeof update === 'function' ? update(previous) : update
    const snapshot = { ...annotationsRef.current, [item.id]: next }
    annotationsRef.current = snapshot
    service?.setAnnotations(item.id, next)
    setAnnotationsByImage(snapshot)
    setCopied(false); setCopyFailed(false)
  }, [item?.id, service])

  const changedEntries = useCallback((): CommitEntry[] => {
    return items.flatMap(candidate => {
      const list = annotationsRef.current[candidate.id] ?? []
      const changed = list.some(note => note.note.trim()) && JSON.stringify(list) !== (openingRef.current[candidate.id] ?? '[]')
      return changed ? [{ item: { src: candidate.src, name: candidate.name }, annotations: list }] : []
    })
  }, [items])

  const doClose = useCallback(async (discard = false): Promise<void> => {
    if (committingRef.current) return
    const entries = changedEntries()
    if (!discard && entries.length && commitAnnotations) {
      setCommitting(true); setCommitError(false)
      try { await commitAnnotations(entries); setCommitting(false); onClose() }
      catch { setCommitting(false); setCommitError(true) }
    } else onClose()
  }, [changedEntries, commitAnnotations, onClose])

  const goPrev = useCallback(() => {
    if (props.onPrev) { props.onPrev(); return }
    if (items.length > 1) onIndex((index - 1 + items.length) % items.length)
  }, [props.onPrev, items.length, index, onIndex])
  const goNext = useCallback(() => {
    if (props.onNext) { props.onNext(); return }
    if (items.length > 1) onIndex((index + 1) % items.length)
  }, [props.onNext, items.length, index, onIndex])

  // Keyboard, focus trap, body scroll lock.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    rootRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (committingRef.current) { event.preventDefault(); event.stopPropagation(); return }
      if (event.defaultPrevented || event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (markupRef.current) {
          // First Escape cancels the in-progress shape; the next exits markup
          // and discards every un-saved mark.
          if (markupDraftRef.current !== undefined) { updateMarkupDraft(undefined); drawingPointerRef.current = undefined }
          else exitMarkup()
          return
        }
        if (event.target instanceof Element && event.target.closest('.igv-inline-note') !== null) {
          setSelected(undefined); rootRef.current?.focus(); return
        }
        void doClose(); return
      }
      if (markupRef.current && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault(); event.stopPropagation()
        setMarkupShapes(current => current.slice(0, -1))
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const editing = event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]') !== null
      if (!editing && ['ArrowLeft', 'ArrowRight', '+', '=', '-', 'f', 'F'].includes(event.key)) event.stopPropagation()
      if (!editing && event.key === 'ArrowLeft') { event.preventDefault(); goPrev() }
      else if (!editing && event.key === 'ArrowRight') { event.preventDefault(); goNext() }
      else if (!editing && !markupRef.current && (event.key === '+' || event.key === '=')) { event.preventDefault(); const box = stageRef.current?.getBoundingClientRect(); if (box) setZoomAt(transformRef.current.zoom * 1.2, box.left + box.width / 2, box.top + box.height / 2) }
      else if (!editing && !markupRef.current && event.key === '-') { event.preventDefault(); const box = stageRef.current?.getBoundingClientRect(); if (box) setZoomAt(transformRef.current.zoom / 1.2, box.left + box.width / 2, box.top + box.height / 2) }
      else if (!editing && !markupRef.current && event.key.toLowerCase() === 'f') { event.preventDefault(); fit() }
      else if (event.key === 'Tab') {
        const controls = [...(rootRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? [])]
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === rootRef.current)) { event.preventDefault(); first?.focus() }
      }
    }
    const root = rootRef.current
    root?.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = previousOverflow; root?.removeEventListener('keydown', onKeyDown) }
  }, [doClose, goPrev, goNext, fit, setZoomAt, exitMarkup, updateMarkupDraft])

  useEffect(() => {
    if (focusNote === undefined) return
    const field = rootRef.current?.querySelector<HTMLTextAreaElement>(`[data-note-id="${CSS.escape(focusNote)}"] textarea`)
    field?.focus()
    setFocusNote(undefined)
  }, [focusNote, selected, annotations.length])

  const addAnnotation = (event: React.MouseEvent): void => {
    if (!annotating || (event.target as Element).closest('.igv-annotation')) return
    const bounds = surfaceRef.current?.getBoundingClientRect()
    if (!bounds || !item) return
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
      note: '',
    }
    setAnnotations(current => [...current, annotation])
    setAnnotating(false); setSelected(annotation.id); setFocusNote(annotation.id)
  }
  const copyNotes = async (): Promise<void> => {
    const text = noteText(annotations, t)
    if (text === '') return
    try { await navigator.clipboard.writeText(text); setCopied(true); setCopyFailed(false) }
    catch { setCopyFailed(true) }
  }
  const annotationPosition = (annotation: Annotation): React.CSSProperties => {
    const ratio = globalThis.devicePixelRatio || 1
    const align = (value: number): number => Math.round(value * ratio) / ratio
    return {
      left: align(geometry.stageWidth / 2 + transform.x + (annotation.x - 0.5) * geometry.width * transform.zoom - 12),
      top: align(geometry.stageHeight / 2 + transform.y + (annotation.y - 0.5) * geometry.height * transform.zoom - 12),
      visibility: imageState === 'ready' ? 'visible' : 'hidden',
    }
  }

  const toggleMarkup = (): void => {
    if (committingRef.current) return
    if (markup) { exitMarkup(); return }
    resetGesture()
    setAnnotating(false); setSelected(undefined)
    setMarkup(true)
  }

  // Pointer → normalized image point. The measured surface rect already carries
  // zoom/pan (and the stage's asymmetric padding), so marks land under the cursor.
  const markupPointFromEvent = (event: React.PointerEvent): MarkupPoint | undefined => {
    const surface = surfaceRef.current
    if (!surface) return undefined
    const rect = surface.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return undefined
    return screenToNormalized(event.clientX, event.clientY, rect)
  }
  const onMarkupPointerDown = (event: React.PointerEvent): void => {
    if (!markupRef.current || imageState !== 'ready' || event.button !== 0 || drawingPointerRef.current !== undefined) return
    if ((event.target as Element).closest('button,a,input,textarea,select')) return
    const point = markupPointFromEvent(event)
    if (!point) return
    event.preventDefault()
    const base = { id: crypto.randomUUID(), color: markupColor, stroke: markupStroke }
    if (markupTool === 'step') {
      setMarkupShapes(current => [...current, { ...base, tool: 'step', points: [point], step: nextStepNumber(current) }])
      return
    }
    if (markupTool === 'text') {
      const text = window.prompt(t('igvMarkupTextPrompt'))?.trim()
      if (text) setMarkupShapes(current => [...current, { ...base, tool: 'text', points: [point], text }])
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingPointerRef.current = event.pointerId
    updateMarkupDraft({ ...base, tool: markupTool, points: markupTool === 'pen' ? [point] : [point, point] })
  }
  const onMarkupPointerMove = (event: React.PointerEvent): void => {
    if (drawingPointerRef.current !== event.pointerId) return
    const point = markupPointFromEvent(event)
    const current = markupDraftRef.current
    if (!point || !current) return
    if (current.tool === 'pen') {
      const last = current.points[current.points.length - 1]
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.002) return
      updateMarkupDraft({ ...current, points: [...current.points, point] })
    } else {
      updateMarkupDraft({ ...current, points: [current.points[0] ?? point, point] })
    }
  }
  const onMarkupPointerUp = (event: React.PointerEvent): void => {
    if (drawingPointerRef.current !== event.pointerId) return
    drawingPointerRef.current = undefined
    const draft = markupDraftRef.current
    updateMarkupDraft(undefined)
    if (draft) setMarkupShapes(current => [...current, draft])
  }
  const onMarkupPointerCancel = (event: React.PointerEvent): void => {
    if (drawingPointerRef.current !== event.pointerId) return
    drawingPointerRef.current = undefined
    updateMarkupDraft(undefined)
  }

  const readOriginalBlob = async (): Promise<Blob> => {
    if (!item) throw new Error('No image')
    if (item.readBlob) return item.readBlob()
    const response = await fetch(item.src)
    if (!response.ok) throw new Error(`Image download failed: ${response.status}`)
    return response.blob()
  }
  /** Bake at natural resolution: original pixels + every shape scaled to them. */
  const bakeMarked = async (): Promise<Blob> => renderMarkupImage(await readOriginalBlob(), markupShapesRef.current)

  const saveMarkup = async (): Promise<void> => {
    if (committingRef.current || !item || markupShapesRef.current.length === 0) return
    if (!commitMarkup) { notifyMarkup(t('igvMarkupNoHost')); return }
    setCommitting(true); setCommitError(false)
    let blob: Blob
    try { blob = await bakeMarked() }
    catch { setCommitting(false); notifyMarkup(t('igvMarkupBakeFailed')); return }
    try {
      const outcome = await commitMarkup([{ item: { src: item.src, name: item.name }, blob, replace: props.draftReplace === true }])
      setCommitting(false)
      setMarkup(false); setMarkupShapes([]); updateMarkupDraft(undefined)
      drawingPointerRef.current = undefined
      notifyMarkup(t(outcome === 'replaced' ? 'igvMarkupReplaced' : outcome === 'fallback' ? 'igvMarkupAddedFallback' : 'igvMarkupSaved'))
    } catch { setCommitting(false); setCommitError(true) }
  }
  const copyMarked = async (): Promise<void> => {
    if (committingRef.current || markupShapesRef.current.length === 0) return
    try {
      const ok = await copyImageBlob(await bakeMarked())
      notifyMarkup(ok ? t('igvCopied') : t('igvCopyFailed'))
    } catch { notifyMarkup(t('igvMarkupBakeFailed')) }
  }
  const downloadMarked = async (): Promise<void> => {
    if (committingRef.current || !item || markupShapesRef.current.length === 0) return
    try {
      const url = URL.createObjectURL(await bakeMarked())
      downloadBlobUrl(url, markedFileName(item.name))
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      notifyMarkup(t('igvMarkupDownloaded'))
    } catch { notifyMarkup(t('igvMarkupBakeFailed')) }
  }

  if (!item) return null
  const showCounter = items.length > 1
  const hasPrev = props.hasPrev ?? index > 0
  const hasNext = props.hasNext ?? index < items.length - 1
  const meta = item.width && item.height ? `${item.width} × ${item.height}` : undefined
  const naturalWidth = imageRef.current?.naturalWidth || item.width || geometry.width || 1
  const naturalHeight = imageRef.current?.naturalHeight || item.height || geometry.height || 1
  const markupEmpty = markupShapes.length === 0

  return (
    <div ref={rootRef} className="dsh-ig-lightbox-backdrop igv-root" role="dialog" aria-modal="true" aria-label={t('igvDialog')} tabIndex={-1}
      onClick={event => { if (event.target === event.currentTarget && !annotating && !markup && transform.zoom === 1) void doClose() }}>
      {committing || commitError ? (
        <div className="igv-draft-status" role="status">
          {t(committing ? 'igvAddingDraft' : 'igvDraftFailed')}
          {commitError ? <button className="igv-btn" type="button" onClick={() => { void doClose(true) }}>{t('igvCloseWithoutDraft')}</button> : null}
        </div>
      ) : markupNotice !== undefined ? (
        <div className="igv-draft-status igv-markup-notice" role="status">{markupNotice}</div>
      ) : null}

      <div className="dsh-ig-lightbox-topbar" onClick={e => e.stopPropagation()}>
        <div className="dsh-ig-lightbox-meta">
          {topMeta}
          {showCounter ? <span className="dsh-ig-lightbox-counter">{index + 1} / {items.length}</span> : null}
          {meta ? <span className="dsh-ig-tag">{meta}</span> : null}
        </div>
        <button type="button" className="dsh-ig-lightbox-close-btn" title={t('igvClose')} onClick={() => { void doClose() }}><X size={18} /></button>
      </div>

      <div className="igv-zoombar" onClick={e => e.stopPropagation()}>
        <button type="button" className="igv-btn" data-active={annotating} aria-pressed={annotating} disabled={imageState !== 'ready' || committing} title={annotating ? t('igvCancelAnnotate') : t('igvAnnotate')} onClick={() => { resetGesture(); setMarkup(false); setMarkupShapes([]); updateMarkupDraft(undefined); drawingPointerRef.current = undefined; setAnnotating(value => !value) }}><PenLine size={14} /><span className="igv-label">{annotating ? t('igvCancelAnnotate') : t('igvAnnotate')}</span></button>
        <button type="button" className="igv-btn" data-active={markup} aria-pressed={markup} disabled={imageState !== 'ready' || committing} title={markup ? t('igvCancelMarkup') : t('igvMarkup')} onClick={toggleMarkup}><PenTool size={14} /><span className="igv-label">{markup ? t('igvCancelMarkup') : t('igvMarkup')}</span></button>
        {annotations.length > 0 ? <button type="button" className="igv-btn" data-active={selected !== undefined} onClick={() => { const first = annotations[0]; if (!first) return; setSelected(current => current === undefined ? first.id : undefined); if (selected === undefined) setFocusNote(first.id) }}>{annotations.length} <span className="igv-label">{t('igvRegions')}</span></button> : null}
        <button type="button" className="igv-btn" title={t('igvFit')} onClick={fit}><Maximize size={14} /><span className="igv-label">{t('igvFit')}</span></button>
        <button type="button" className="igv-btn" disabled={imageState !== 'ready'} onClick={actual}>{t('igvActual')}</button>
        <button type="button" className="igv-btn" title="-" onClick={() => { const box = stageRef.current?.getBoundingClientRect(); if (box) setZoomAt(transformRef.current.zoom / 1.2, box.left + box.width / 2, box.top + box.height / 2) }}><ZoomOut size={14} /></button>
        <span className="igv-zoom">{Math.round(transform.zoom * pixelScale * 100)}%</span>
        <button type="button" className="igv-btn" title="+" onClick={() => { const box = stageRef.current?.getBoundingClientRect(); if (box) setZoomAt(transformRef.current.zoom * 1.2, box.left + box.width / 2, box.top + box.height / 2) }}><ZoomIn size={14} /></button>
        {annotations.some(annotation => annotation.note.trim() !== '') ? <button type="button" className="igv-btn" title={copyFailed ? t('igvCopyFailed') : copied ? t('igvCopied') : t('igvCopyNotes')} onClick={() => { void copyNotes() }}>{copied ? <Check size={14} /> : <Copy size={14} />}<span className="igv-label">{copyFailed ? t('igvCopyFailed') : copied ? t('igvCopied') : t('igvCopyNotes')}</span></button> : null}
        {(viewerActions ?? []).map(action => <GenericAction key={action.id} action={action} annotations={annotations} item={item} onDone={close => { if (close) void doClose() }} />)}
      </div>

      {markup ? (
        <div className="igv-markup-palette" role="toolbar" aria-label={t('igvMarkup')} onClick={e => e.stopPropagation()}>
          <div className="igv-markup-group">
            {MARKUP_TOOLS.map(({ tool, key, Icon }) => (
              <button key={tool} type="button" className="igv-btn igv-markup-tool" data-active={markupTool === tool} aria-pressed={markupTool === tool} disabled={committing} title={t(key)} onClick={() => setMarkupTool(tool)}><Icon size={14} /></button>
            ))}
          </div>
          <span className="igv-markup-sep" />
          <div className="igv-markup-group" role="group" aria-label={t('igvMarkupColor')}>
            {MARKUP_COLORS.map(swatch => (
              <button key={swatch} type="button" className="igv-swatch" style={{ background: swatch }} data-active={markupColor === swatch} aria-pressed={markupColor === swatch} aria-label={swatch} title={swatch} disabled={committing} onClick={() => setMarkupColor(swatch)} />
            ))}
          </div>
          <span className="igv-markup-sep" />
          <div className="igv-markup-group" role="group" aria-label={t('igvMarkupStroke')}>
            {MARKUP_STROKES.map(size => (
              <button key={size} type="button" className="igv-btn igv-markup-tool" data-active={markupStroke === size} aria-pressed={markupStroke === size} disabled={committing} title={t(size === 'S' ? 'igvStrokeS' : size === 'M' ? 'igvStrokeM' : 'igvStrokeL')} onClick={() => setMarkupStroke(size)}><span className="igv-stroke-dot" data-size={size} /></button>
            ))}
          </div>
          <span className="igv-markup-sep" />
          <div className="igv-markup-group">
            <button type="button" className="igv-btn igv-markup-tool" disabled={committing || markupEmpty} title={t('igvMarkupUndo')} onClick={() => setMarkupShapes(current => current.slice(0, -1))}><Undo2 size={14} /></button>
            <button type="button" className="igv-btn igv-markup-tool" disabled={committing || markupEmpty} title={t('igvMarkupClear')} onClick={() => { setMarkupShapes([]); updateMarkupDraft(undefined) }}><Trash2 size={14} /></button>
          </div>
          <span className="igv-markup-sep" />
          <div className="igv-markup-group">
            <button type="button" className="igv-btn" disabled={committing || markupEmpty} title={t('igvMarkupCopy')} onClick={() => { void copyMarked() }}><Copy size={14} /><span className="igv-label">{t('igvMarkupCopy')}</span></button>
            <button type="button" className="igv-btn" disabled={committing || markupEmpty} title={t('igvMarkupDownload')} onClick={() => { void downloadMarked() }}><Download size={14} /><span className="igv-label">{t('igvMarkupDownload')}</span></button>
            <button type="button" className="igv-btn igv-markup-save" disabled={committing || markupEmpty} title={t('igvMarkupSaveHint')} onClick={() => { void saveMarkup() }}><Save size={14} /><span className="igv-label">{t('igvMarkupSave')}</span></button>
            <button type="button" className="igv-btn" disabled={committing} title={t('igvCancelMarkup')} onClick={exitMarkup}><X size={14} /><span className="igv-label">{t('igvCancelMarkup')}</span></button>
          </div>
        </div>
      ) : null}

      {showCounter ? (
        <>
          <button type="button" className="dsh-ig-lightbox-nav-btn dsh-ig-lightbox-nav-prev" title={t('igvPrevious')} disabled={!hasPrev} onClick={e => { e.stopPropagation(); goPrev() }}><ChevronLeft size={24} /></button>
          <button type="button" className="dsh-ig-lightbox-nav-btn dsh-ig-lightbox-nav-next" title={t('igvNext')} disabled={!hasNext} onClick={e => { e.stopPropagation(); goNext() }}><ChevronRight size={24} /></button>
        </>
      ) : null}

      <div ref={stageRef} className="igv-stage" data-dragging={dragging} data-annotating={annotating} data-markup={markup}
        onClick={event => { if (event.target === event.currentTarget && !annotating && !markup && transform.zoom === 1) void doClose() }}
        {...(!annotating && !markup && imageState === 'ready' ? pointerHandlers : {})}
        onDoubleClick={event => { if (markup || (event.target as Element).closest('button,a,input,textarea') || imageState !== 'ready') return; if (transform.zoom === 1) actual(); else fit() }}>
        {imageState !== 'ready' ? (
          <div className="igv-load-status" role={imageState === 'error' ? 'alert' : 'status'}>
            {t(imageState === 'error' ? 'igvLoadFailed' : 'igvLoading')}
            {imageState === 'error' ? <button type="button" className="igv-btn" onClick={() => { setImageState('loading'); setAttempt(value => value + 1) }}>{t('igvRetry')}</button> : null}
          </div>
        ) : null}
        <div ref={surfaceRef} className="igv-surface" data-markup={markup} onClick={addAnnotation} style={{ visibility: imageState === 'ready' ? 'visible' : 'hidden', transform: `translate3d(${transform.x}px,${transform.y}px,0) scale(${transform.zoom})` }}
          {...(markup && imageState === 'ready' ? { onPointerDown: onMarkupPointerDown, onPointerMove: onMarkupPointerMove, onPointerUp: onMarkupPointerUp, onPointerCancel: onMarkupPointerCancel, onLostPointerCapture: onMarkupPointerCancel } : {})}>
          <img key={`${identity}:${attempt}`} ref={imageRef} className="dsh-ig-lightbox-img igv-image" src={item.src} alt={item.name} draggable={false} decoding="async"
            onLoad={() => { setImageState('ready'); measure() }}
            onError={() => { if (!item.src) return; if (onImageError) onImageError(item, item.src); else setImageState('error') }} />
          {markup && imageState === 'ready' ? <MarkupOverlay shapes={markupShapes} draft={markupDraft} width={naturalWidth} height={naturalHeight} /> : null}
        </div>
        {annotations.map((annotation, position) => (
          <div className="igv-annotation" data-x={annotation.x < 0.38 ? 'right' : annotation.x > 0.62 ? 'left' : 'center'} data-y={annotation.y < 0.28 ? 'down' : 'up'} style={annotationPosition(annotation)} key={annotation.id}>
            <button type="button" className="igv-pin" data-active={selected === annotation.id} aria-label={fill(t('igvNote'), { value: String(position + 1) })} onClick={event => { event.stopPropagation(); const opening = selected !== annotation.id; setSelected(opening ? annotation.id : undefined); if (opening) setFocusNote(annotation.id) }}>{position + 1}</button>
            {selected === annotation.id ? (
              <div className="igv-inline-note" data-note-id={annotation.id} onClick={event => event.stopPropagation()}>
                <span className="igv-inline-index">{position + 1}</span>
                <textarea value={annotation.note} rows={1} aria-label={fill(t('igvNote'), { value: String(position + 1) })} placeholder={t('igvNotePlaceholder')}
                  onChange={event => { const note = event.target.value; setAnnotations(current => current.map(entry => entry.id === annotation.id ? { ...entry, note } : entry)) }}
                  onKeyDown={event => {
                    if (event.nativeEvent?.isComposing) return
                    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') {
                      event.preventDefault(); event.stopPropagation(); event.nativeEvent?.stopImmediatePropagation?.()
                      setSelected(undefined); rootRef.current?.focus()
                    }
                  }} />
                <button type="button" className="igv-note-remove" aria-label={t('igvRemoveNote')} onClick={event => { event.stopPropagation(); setAnnotations(current => current.filter(entry => entry.id !== annotation.id)); setSelected(undefined); rootRef.current?.focus() }}><Trash2 size={13} /></button>
              </div>
            ) : null}
          </div>
        ))}
        {markup ? <span className="igv-hint">{t('igvMarkupHint')}</span> : annotating ? <span className="igv-hint">{t('igvRegionHint')}</span> : transform.zoom === 1 && !showCounter ? <span className="igv-hint">{t('igvZoomHint')}</span> : null}
      </div>

      {prompt !== undefined || actions ? (
        <div className="dsh-ig-lightbox-bottombar" onClick={e => e.stopPropagation()}>
          {prompt !== undefined ? <div className="dsh-ig-lightbox-prompt-text" title={prompt}>{prompt}</div> : null}
          {actions ? <div className="dsh-ig-lightbox-actions">{actions}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Standalone overlay driven by the public service (shell.overlay seat). */
export function ViewerOverlay({ service, t, commitMarkup }: { service: ImageViewerService; t: ViewerT; commitMarkup?: ((entries: MarkupCommitEntry[]) => Promise<void | MarkupCommitOutcome>) | undefined }) {
  const request = useSyncExternalStore(service.subscribe, service.getSnapshot)
  const [cursor, setCursor] = useState({ revision: 0, index: 0 })
  if (!request) return null
  const index = cursor.revision === request.revision ? cursor.index : request.index
  const setIndex = (next: number): void => setCursor({ revision: request.revision, index: next })
  return (
    <ImageLightbox
      items={request.items}
      index={index}
      onIndex={setIndex}
      onClose={() => { void service.close({ discard: true }) }}
      t={t}
      service={service}
      prompt={request.items[index]?.prompt}
      viewerActions={request.items[index]?.actions}
      commitAnnotations={request.commitAnnotations}
      commitMarkup={commitMarkup}
      draftReplace={request.origin === 'composer'}
    />
  )
}

export { renderAnnotationImage }
