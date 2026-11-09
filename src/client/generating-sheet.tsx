/** React host for the "picture being made" panel (see generating-panel.ts). */
import { useEffect, useRef } from 'react'
import { createGeneratingPanel, type GeneratingPanel } from './generating-panel.js'

/** Attachments whose generation the user watched, so the card that finally shows them plays the reveal. */
const fresh = new Set<string>()
export const markFreshImage = (id: string | number): void => { fresh.add(String(id)) }
export const isFreshImage = (id: string | number | undefined): boolean => id !== undefined && fresh.has(String(id))
export const forgetFreshImage = (id: string | number | undefined): void => { if (id !== undefined) fresh.delete(String(id)) }

const MAX_SIDE = 520

export interface GeneratingSheetProps {
  /** Words under the clock. */
  stage: string
  /** Set once the picture can be shown: it is rippled in, then onRevealed fires. */
  url?: string | undefined
  /** Set when the picture will not come: the sheet stills and greys with this reason. */
  failure?: string | undefined
  onRevealed?: (() => void) | undefined
}

export function GeneratingSheet({ stage, url, failure, onRevealed }: GeneratingSheetProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<GeneratingPanel>()
  const revealedRef = useRef(onRevealed)
  revealedRef.current = onRevealed

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const panel = createGeneratingPanel(host, { stage })
    panelRef.current = panel
    return () => {
      panel.destroy()
      if (panelRef.current === panel) panelRef.current = undefined
    }
  }, [])

  useEffect(() => { panelRef.current?.setStage(stage) }, [stage])

  useEffect(() => {
    if (failure !== undefined && url === undefined) panelRef.current?.fail(failure)
  }, [failure, url])

  useEffect(() => {
    const panel = panelRef.current
    const host = hostRef.current
    if (url === undefined || !panel || !host) return
    let canceled = false
    const image = new Image()
    image.src = url
    void image.decode().then(() => {
      if (canceled) return
      // The sheet takes the size the <img> will have (max 520 px each way), so the swap does not jump.
      const aspect = image.naturalWidth / Math.max(1, image.naturalHeight)
      const room = host.parentElement?.clientWidth || host.clientWidth || MAX_SIDE
      const width = Math.max(1, Math.min(image.naturalWidth, room, MAX_SIDE, MAX_SIDE * aspect))
      return panel.reveal(image, { width, height: width / aspect })
    }).catch(() => undefined).then(() => {
      if (!canceled) revealedRef.current?.()
    })
    return () => { canceled = true }
  }, [url])

  return <div ref={hostRef} className="dsh-ig-generating" />
}
