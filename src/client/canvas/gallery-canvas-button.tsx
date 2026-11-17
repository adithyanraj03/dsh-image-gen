import { useSyncExternalStore, type FC } from 'react'
import { Frame } from 'lucide-react'
import type { GalleryItem } from '../gallery-store.js'
import { galleryLanding } from './gallery-image-transfer.js'
import { hasCanvasLandingConsumer, sendCanvasLandingToOpenCanvas, subscribeCanvasLandingAvailability } from './canvas-bridge.js'

/** An explicit alternative to native dragging, including a visible unavailable state. */
export const GalleryCanvasButton: FC<{
  item: GalleryItem
  lang: 'zh' | 'en'
  disabled?: boolean
  className?: string
  onToast(message: string): void
  /**
   * Studio infinite-canvas mode: arm click-to-place instead of queueing an
   * immediate landing. The user then clicks the canvas to position the image.
   */
  onArm?: ((item: GalleryItem) => void) | undefined
}> = ({ item, lang, disabled, className, onToast, onArm }) => {
  const available = useSyncExternalStore(subscribeCanvasLandingAvailability, hasCanvasLandingConsumer, () => false)
  const open = lang === 'en' ? 'Open the infinite canvas first' : '请先打开无限画布'
  const title = !available ? open : disabled
    ? lang === 'en' ? 'Wait for the image to load' : '请等待图片加载完成'
    : onArm
      ? lang === 'en' ? 'Place on canvas (click to position)' : '放置到画布（点击定位）'
      : lang === 'en' ? 'Send to canvas' : '发送到画布'
  return <button type="button" className={className} title={title} aria-label={title} disabled={!available || disabled}
    onClick={event => {
      event.stopPropagation()
      if (onArm) {
        onArm(item)
        onToast(lang === 'en' ? 'Click the canvas to place' : '点击画布放置图片')
        return
      }
      const sent = sendCanvasLandingToOpenCanvas(galleryLanding(item))
      onToast(sent ? lang === 'en' ? 'Sent to canvas' : '已发送到画布' : open)
    }}><Frame size={14} /></button>
}
