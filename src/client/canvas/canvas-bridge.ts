/**
 * One-shot delivery into the persistent canvas document. The first mounted
 * editor handles a batch; the document is shared, so other surfaces see the
 * same elements. Delivered items are removed, so deleting an element never
 * triggers a replay.
 */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

export interface CanvasLandingItem {
  /** Gallery item id; also used to dedupe elements via customData.galleryId. */
  galleryId: string
  attachment: ImageAttachmentRef
  /** Live conversation delivery; discard unfinished delivery when all canvases close. */
  fromConversation?: boolean
  /** Explicit history actions must not resume after the last canvas closes. */
  onlyWhileCanvasOpen?: boolean
  /**
   * Generation provenance copied onto the landed element's customData: the
   * canvas digest then tells the model how each image was made, so "regenerate
   * this" or "vary this" reuses the original prompt and model instead of
   * guessing. All optional; elements landed from older paths carry none.
   */
  prompt?: string
  provider?: string
  model?: string
}

type CanvasLandingConsumer = (items: readonly CanvasLandingItem[]) => Promise<boolean>
const pending = new Map<string, CanvasLandingItem>()
const consumers = new Set<CanvasLandingConsumer>()
const availabilityListeners = new Set<() => void>()
let delivering = false
let generation = 0

/** History actions must not silently queue into a canvas that is not open. */
export function hasCanvasLandingConsumer(): boolean { return consumers.size > 0 }
export function subscribeCanvasLandingAvailability(listener: () => void): () => void {
  availabilityListeners.add(listener)
  return () => { availabilityListeners.delete(listener) }
}
export function sendCanvasLandingToOpenCanvas(item: CanvasLandingItem): boolean {
  if (!hasCanvasLandingConsumer()) return false
  pushCanvasLandings([{ ...item, onlyWhileCanvasOpen: true }])
  return true
}

/** Invalidates async landings that started before the user cleared the canvas. */
export function getCanvasLandingGeneration(): number { return generation }

export function clearCanvasLandings(): void {
  generation += 1
  pending.clear()
}

/** Queue freshly generated images for the canvases. Safe to call anywhere. */
export function pushCanvasLandings(newItems: readonly CanvasLandingItem[]): void {
  for (const item of newItems) {
    if (!pending.has(item.galleryId)) pending.set(item.galleryId, item)
  }
  void deliver()
}

/** Conversation results are admitted only while a canvas is mounted. */
export function pushCanvasLandingsLive(items: readonly CanvasLandingItem[]): void {
  if (consumers.size > 0) pushCanvasLandings(items)
}

/** Register a ready editor. False means it unmounted before committing. */
export function registerCanvasLandingConsumer(consumer: CanvasLandingConsumer): () => void {
  const wasAvailable = hasCanvasLandingConsumer()
  consumers.add(consumer)
  if (!wasAvailable) for (const listener of availabilityListeners) listener()
  void deliver()
  let registered = true
  return () => {
    if (!registered) return
    registered = false
    consumers.delete(consumer)
    if (consumers.size === 0) {
      for (const [id, item] of pending) {
        if (item.fromConversation || item.onlyWhileCanvasOpen) pending.delete(id)
      }
      for (const listener of availabilityListeners) listener()
    }
  }
}

async function deliver(): Promise<void> {
  if (delivering) return
  delivering = true
  try {
    while (pending.size > 0) {
      const consumer = consumers.values().next().value
      if (consumer === undefined) break
      const batch = [...pending.values()]
      let completed = true
      try {
        completed = await consumer(batch)
      } catch (error) {
        // A failed batch must not become an infinite retry/replay loop.
        console.warn('[dsh-image-gen] canvas landing failed:', error)
      }
      if (completed) {
        for (const item of batch) {
          if (pending.get(item.galleryId) === item) pending.delete(item.galleryId)
        }
      }
    }
  } finally {
    delivering = false
  }
}
