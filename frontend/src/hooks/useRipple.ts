// Отклик на нажатие: от точки касания по кнопке расходится мягкая волна, а на телефоне — короткая вибрация.
// Один слушатель на документ: не нужно оборачивать каждую кнопку. Волна живёт в отдельном слое
// внутри элемента и сама себя удаляет, поэтому разметку React не трогает.

import { useEffect } from 'react'

export const RIPPLE_TARGETS = [
  '.btn',
  '.icon-btn',
  '.choice',
  '.rail-link',
  '.tab',
  '.item-row--link',
  '.dd__trigger',
  '.dd__option',
  '.seg__item',
  '.day-tab',
  '.time-chip',
  '.cal__day',
  '.stepper button',
  '.notif',
  '.theme-switch',
  '.walk-row',
].join(', ')

const isCalm = () => document.documentElement.dataset.motion === 'calm'

export function useRipple() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if ((e.button ?? 0) !== 0 || !(e.target instanceof Element)) return
      const el = e.target.closest<HTMLElement>(RIPPLE_TARGETS)
      if (!el || el.matches(':disabled, [aria-disabled="true"]')) return
      // Короткая вибрация — только на сенсорных экранах, где «щелчка» мыши нет.
      if (e.pointerType === 'touch' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(8)
        } catch {
          /* некоторые браузеры запрещают вибрацию — не страшно */
        }
      }
      if (isCalm() || typeof el.animate !== 'function') return
      const r = el.getBoundingClientRect()
      const size = Math.hypot(r.width, r.height) * 2
      const host = document.createElement('span')
      host.className = 'ripple-host'
      const dot = document.createElement('span')
      dot.className = 'ripple'
      dot.style.width = dot.style.height = `${size}px`
      dot.style.left = `${e.clientX - r.left - size / 2}px`
      dot.style.top = `${e.clientY - r.top - size / 2}px`
      host.appendChild(dot)
      el.appendChild(host)
      const anim = dot.animate(
        [
          { transform: 'scale(0)', opacity: 0.32 },
          { transform: 'scale(1)', opacity: 0 },
        ],
        { duration: 720, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      )
      anim.onfinish = () => host.remove()
    }
    document.addEventListener('pointerdown', onDown, { passive: true })
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])
}
