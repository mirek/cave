import type { FocusEvent } from 'react'

const clearHeader = (element: HTMLElement): void => {
  const headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0
  const top = element.getBoundingClientRect().top
  if (top < headerBottom + 12) {
    window.scrollBy({ top: top - headerBottom - 12, left: 0, behavior: 'instant' })
  }
}

/** Reveal an element below the measured sticky header. */
export const revealBelowHeader = (element: HTMLElement): void => {
  element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' })
  clearHeader(element)
}

/** Reveal the beginning of a keyboard-focused scroll region below the header. */
export const revealFocusedBlock = (event: FocusEvent<HTMLElement>): void => {
  if (event.defaultPrevented || event.target !== event.currentTarget || !event.currentTarget.matches(':focus-visible')) return
  const element = event.currentTarget
  revealBelowHeader(element)
  // Native focus scrolling can apply another scroll after the focus handler.
  // Correct clearance on the next frame without restarting horizontal scrolling
  // or acting after focus has moved to another control.
  requestAnimationFrame(() => {
    if (element.isConnected && document.activeElement === element && element.matches(':focus-visible')) clearHeader(element)
  })
}
