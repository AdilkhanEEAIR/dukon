// «Товар полетел в заказ»: копия иконки товара по дуге улетает к пункту «Заказы» в меню,
// а сам пункт подпрыгивает. Человек видит, куда делось то, что он добавил.

const ORDERS_LINK = 'a[href="/app/orders"]'

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/** Подпрыгивание цели: увеличилась и вернулась, с вспышкой акцента. */
export function bump(el: Element) {
  if (typeof (el as HTMLElement).animate !== 'function') return
  ;(el as HTMLElement).animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.18)', offset: 0.35 },
      { transform: 'scale(0.96)', offset: 0.7 },
      { transform: 'scale(1)' },
    ],
    { duration: 520, easing: 'ease-out' },
  )
  el.classList.add('is-bumped')
  window.setTimeout(() => el.classList.remove('is-bumped'), 900)
}

/** from — что летит (иконка товара); startAt — откуда стартует, если сама иконка уехала из вида
 *  (в шторке кнопка внизу, а иконка прокручена вверх). */
export function flyToOrders(from: Element | null, startAt?: Element | null) {
  const target = [...document.querySelectorAll(ORDERS_LINK)].find(visible)
  if (!target) return
  const calm = document.documentElement.dataset.motion === 'calm'
  if (!from || calm || typeof (from as HTMLElement).animate !== 'function') {
    bump(target)
    return
  }
  const icon = from.getBoundingClientRect()
  const inView = icon.bottom > 0 && icon.top < window.innerHeight
  const origin = !inView && startAt ? startAt.getBoundingClientRect() : icon
  // Летит иконка своего размера, но из центра точки старта.
  const a = { left: origin.left + origin.width / 2 - icon.width / 2, top: origin.top + origin.height / 2 - icon.height / 2, width: icon.width, height: icon.height }
  const b = target.getBoundingClientRect()
  const ghost = from.cloneNode(true) as HTMLElement
  ghost.classList.add('fly-ghost')
  // В заказ летит товар «в цвете», даже если на полке его нет и плитка была бледной.
  ghost.classList.remove('pi--empty')
  ghost.removeAttribute('data-testid')
  Object.assign(ghost.style, { position: 'fixed', left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, margin: '0', zIndex: '1000', pointerEvents: 'none' })
  document.body.appendChild(ghost)
  const dx = b.left + b.width / 2 - (a.left + a.width / 2)
  const dy = b.top + b.height / 2 - (a.top + a.height / 2)
  // Дуга: середина пути поднята вверх — предмет «подбрасывают», а не тащат по прямой.
  const lift = Math.min(160, Math.abs(dx) * 0.25 + 60)
  const anim = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.18}px, ${dy * 0.18 - lift * 0.8}px) scale(1.15) rotate(-10deg)`, opacity: 1, offset: 0.28 },
      { transform: `translate(${dx * 0.62}px, ${dy * 0.62 - lift * 0.5}px) scale(0.7) rotate(6deg)`, opacity: 1, offset: 0.68 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.2) rotate(14deg)`, opacity: 0.3 },
    ],
    { duration: 900, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' },
  )
  anim.onfinish = () => {
    ghost.remove()
    bump(target)
  }
}
