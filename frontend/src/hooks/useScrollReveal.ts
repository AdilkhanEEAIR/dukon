// Появление при прокрутке — на каждом блоке каждой страницы, без обёрток в разметке.
// Один IntersectionObserver на весь документ и MutationObserver, который подхватывает новые блоки
// (данные пришли, сменилась страница). Анимации — через Web Animations API, а не CSS-переходы:
// так они не спорят с hover-переходами карточек и кнопок, у которых свой transition.
//
// Поведение в обе стороны: блок ниже экрана ждёт спрятанным и выезжает снизу, когда до него докрутили;
// крутим вверх — нижние блоки уходят вниз с затуханием, верхние спускаются на место.

import { useEffect } from 'react'

// Что считается «компонентом». Вложенные цели (строка внутри карточки) тоже появляются — каскадом за родителем.
export const REVEAL_TARGETS = [
  '.page > *',
  '.page > * > :is(.sheet, .two-col, .metric-row, .chart-card, .section, .stack)',
  '.two-col > *',
  '.home-cols > .stack > *',
  '.sheet',
  '.chart-card',
  '.metric',
  '.rows > *',
  '.item-row',
  '.notif',
  '.branch-row',
  '.shop-card',
  '.step-card',
  '.model',
  '.landing > section',
  '.landing > section > *',
  '.landing__footer',
  '[data-reveal]',
].join(', ')

// Плавающие слои и навигация не участвуют: они должны быть на месте всегда.
const SKIP = '.dd__menu, .drawer, .scrim, .toasts, .tabbar, .rail, [data-no-reveal]'

type State = 'in' | 'above' | 'below'

// Мягкий «экспоненциальный» выход: быстро стартует и очень долго дотягивает — читается как плавность, а не скорость.
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const EASE_AWAY = 'cubic-bezier(0.45, 0, 0.55, 1)'

function hiddenFrame(state: Exclude<State, 'in'>, nested: boolean, calm: boolean): Keyframe {
  if (calm) return { opacity: 0 }
  const dy = (nested ? 10 : 22) * (state === 'below' ? 1 : -1)
  return { opacity: 0, translate: `0 ${dy}px`, scale: nested ? '1' : '0.98', filter: 'blur(8px)' }
}
const SHOWN: Keyframe = { opacity: 1, translate: '0 0', scale: '1', filter: 'blur(0px)' }
const SHOWN_CALM: Keyframe = { opacity: 1 }

const isCalm = () => document.documentElement.dataset.motion === 'calm'

export function useScrollReveal(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('IntersectionObserver' in window)) return
    const states = new WeakMap<Element, State>()
    const running = new WeakMap<Element, Animation>()
    const tracked = new Set<Element>()
    // Блоки, появившиеся уже после первого кадра (пришли данные, открылась страница): им тоже нужен въезд.
    const late = new WeakSet<Element>()
    let initial = true

    const isNested = (el: Element) => !!el.parentElement?.closest(REVEAL_TARGETS)

    const play = (el: HTMLElement, from: Keyframe | null, to: Keyframe, opts: KeyframeAnimationOptions) => {
      if (typeof el.animate !== 'function') return
      running.get(el)?.cancel()
      const frames = from ? [from, to] : [to]
      // both: пока идёт задержка каскада, блок уже стоит в начальном (спрятанном) кадре — без мигания.
      const anim = el.animate(frames, { fill: from ? 'both' : 'forwards', ...opts })
      running.set(el, anim)
      // Показанный блок отпускаем: стиль возвращается к CSS, и hover/transform карточек работают как обычно.
      if (to === SHOWN || to === SHOWN_CALM) {
        anim.onfinish = () => {
          if (running.get(el) === anim) {
            anim.cancel()
            running.delete(el)
          }
        }
      }
    }

    const io = new IntersectionObserver(
      (entries) => {
        const calm = isCalm()
        let order = 0
        // Сверху вниз: каскад идёт в порядке чтения, а не в порядке, в котором браузер прислал записи.
        const sorted = [...entries].sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        for (const entry of sorted) {
          const el = entry.target as HTMLElement
          const prev = states.get(el)
          const rootH = entry.rootBounds?.height ?? window.innerHeight
          const next: State = entry.isIntersecting ? 'in' : entry.boundingClientRect.top >= rootH / 2 ? 'below' : 'above'
          if (prev === next) continue
          states.set(el, next)
          const nested = isNested(el)
          if (next === 'in') {
            // Уже на экране при первом наблюдении. Прямых детей .stagger показывает CSS-каскад открытия страницы;
            // остальное, что добавилось позже (строки списка, карточки после загрузки), въезжает каскадом здесь.
            if (prev === undefined && (!late.has(el) || el.matches('.stagger > *'))) continue
            const from: Exclude<State, 'in'> = prev === undefined || prev === 'in' ? 'below' : prev
            const delay = Math.min(order++, 8) * (nested ? 100 : 150)
            play(el, hiddenFrame(from, nested || prev === undefined, calm), calm ? SHOWN_CALM : SHOWN, {
              duration: calm ? 1000 : 1900,
              easing: EASE,
              delay,
            })
          } else if (prev === undefined) {
            // Вне экрана с самого начала: прячем мгновенно, пользователь этого не видит.
            play(el, null, hiddenFrame(next, nested, calm), { duration: 0 })
          } else {
            play(el, null, hiddenFrame(next, nested, calm), { duration: calm ? 700 : 1150, easing: EASE_AWAY })
          }
        }
      },
      // Нижние 6% экрана считаются «ещё не тут»: блок выезжает, когда его уже видно, и уходит у края на глазах.
      { rootMargin: '0px 0px -6% 0px', threshold: 0 },
    )

    const consider = (el: Element) => {
      if (tracked.has(el) || el.closest(SKIP)) return
      tracked.add(el)
      if (!initial) late.add(el)
      io.observe(el)
    }
    const scan = (root: ParentNode) => {
      if (root instanceof Element && root.matches(REVEAL_TARGETS)) consider(root)
      root.querySelectorAll(REVEAL_TARGETS).forEach(consider)
    }
    const forget = (el: Element) => {
      if (!tracked.has(el)) return
      tracked.delete(el)
      io.unobserve(el)
      running.get(el)?.cancel()
    }

    scan(document.body)
    initial = false

    // Страховка у самого низа: короткий последний блок может так и не пересечь отступ в 6% —
    // докрутили до конца, значит показываем всё, что спрятано ниже.
    let scrollFrame = 0
    const atBottom = () => {
      scrollFrame = 0
      const doc = document.documentElement
      if (window.scrollY + window.innerHeight < doc.scrollHeight - 4) return
      const calm = isCalm()
      tracked.forEach((el) => {
        if (states.get(el) !== 'below' || el.getBoundingClientRect().top >= window.innerHeight) return
        states.set(el, 'in')
        play(el as HTMLElement, hiddenFrame('below', isNested(el), calm), calm ? SHOWN_CALM : SHOWN, { duration: calm ? 1000 : 1900, easing: EASE })
      })
    }
    // Все отложенные проверки запоминаем: после размонтирования (смена страницы, конец теста) их нужно снять.
    const timers = new Set<number>()
    let disposed = false
    const onScroll = () => {
      if (!disposed && !scrollFrame) scrollFrame = requestAnimationFrame(atBottom)
    }
    const later = () => {
      const id = window.setTimeout(() => {
        timers.delete(id)
        onScroll()
      }, 700)
      timers.add(id)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    // Короткая страница не прокручивается вовсе — проверяем низ и без прокрутки, после первого прохода наблюдателя.
    later()

    // Новые узлы досканируем пачкой раз в кадр: при загрузке списка их приходят десятки.
    let pending: Node[] = []
    let frame = 0
    const flush = () => {
      frame = 0
      const nodes = pending
      pending = []
      for (const n of nodes) if (n instanceof Element && n.isConnected) scan(n)
      later()
    }
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => pending.push(n))
        r.removedNodes.forEach((n) => {
          if (!(n instanceof Element)) return
          forget(n)
          n.querySelectorAll(REVEAL_TARGETS).forEach(forget)
        })
      }
      if (pending.length && !frame) frame = requestAnimationFrame(flush)
    })
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      mo.disconnect()
      io.disconnect()
      window.removeEventListener('scroll', onScroll)
      disposed = true
      timers.forEach((id) => window.clearTimeout(id))
      timers.clear()
      if (frame) cancelAnimationFrame(frame)
      if (scrollFrame) cancelAnimationFrame(scrollFrame)
      tracked.forEach((el) => running.get(el)?.cancel())
      tracked.clear()
    }
  }, [enabled])
}
