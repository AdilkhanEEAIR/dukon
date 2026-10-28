// Выбор обхода по датам. Обходов со временем станет много, и ряд кнопок «26 окт · 08:53» перестанет помещаться,
// поэтому: неделя вкладками (последние семь дней, листается стрелками) и полный календарь месяца по кнопке.
// Дни без обходов неактивны, у дня с несколькими обходами — их число и время под неделей.

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Walk } from '../api/types'
import { useI18n, type Locale } from '../i18n'
import { capitalize, formatTime } from '../lib/format'

const DAY = 86_400_000

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function intlLocale(locale: Locale): string {
  return locale === 'ky' ? 'ru' : locale
}

/** Обходы по дням (местное время), внутри дня — по времени. */
export function groupByDay(walks: Walk[]): Map<string, Walk[]> {
  const map = new Map<string, Walk[]>()
  for (const w of [...walks].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const k = dayKey(new Date(w.created_at))
    map.set(k, [...(map.get(k) ?? []), w])
  }
  return map
}

/** Последний день недели-окна: неделя заканчивается сегодня, если выбранный обход в ней, иначе — через 3 дня после него. */
export function weekEndFor(selected: Date, today: Date): Date {
  const sel = startOfDay(selected)
  const t = startOfDay(today)
  const end = addDays(sel, 3)
  return end > t ? (sel > t ? sel : t) : end
}

export function WalkCalendar({ walks, current }: { walks: Walk[]; current: Walk }) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const byDay = useMemo(() => groupByDay(walks), [walks])
  const selected = useMemo(() => startOfDay(new Date(current.created_at)), [current.created_at])
  // «Сегодня» фиксируем при открытии экрана: так расчёт недели не меняется между перерисовками.
  const [today] = useState(() => startOfDay(new Date()))
  const [end, setEnd] = useState(() => weekEndFor(selected, today))
  const [open, setOpen] = useState(false)
  const group = useId()

  // Выбрали обход вне видимой недели (из календаря, по ссылке) — неделя сама переезжает к нему.
  const [seenSel, setSeenSel] = useState(selected.getTime())
  if (seenSel !== selected.getTime()) {
    setSeenSel(selected.getTime())
    if (selected < addDays(end, -6) || selected > end) setEnd(weekEndFor(selected, today))
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6))
  const L = intlLocale(locale)
  const weekday = new Intl.DateTimeFormat(L, { weekday: 'short' })
  const range = (() => {
    const f = new Intl.DateTimeFormat(L, { day: 'numeric', month: 'short' })
    const fr = f as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string }
    return fr.formatRange ? fr.formatRange(days[0], days[6]) : `${f.format(days[0])} – ${f.format(days[6])}`
  })()
  const dayWalks = byDay.get(dayKey(selected)) ?? []
  const go = (w: Walk) => navigate(`/app/shelves/${w.id}`)
  const pickDay = (d: Date) => {
    const list = byDay.get(dayKey(d))
    if (list?.length) go(list[list.length - 1])
  }

  return (
    <div className="walk-cal" data-testid="walk-calendar">
      <div className="walk-cal__bar">
        <CalendarPopover open={open} setOpen={setOpen} byDay={byDay} selected={selected} today={today} onPick={(d) => { setOpen(false); setEnd(weekEndFor(d, today)); pickDay(d) }} />
        <button type="button" className="icon-btn walk-cal__nav" aria-label={t('calendar.prevWeek')} onClick={() => setEnd(addDays(end, -7))} data-testid="week-prev">
          <ChevronLeft size={18} />
        </button>
        <div className="walk-cal__week" role="tablist" aria-label={`${t('calendar.week')}: ${range}`}>
          {days.map((d) => {
            const k = dayKey(d)
            const list = byDay.get(k) ?? []
            const active = k === dayKey(selected)
            const isToday = k === dayKey(today)
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`${weekday.format(d)} ${d.getDate()}${list.length ? ` · ${t('calendar.walks', { n: list.length })}` : ` · ${t('calendar.noWalks')}`}`}
                disabled={!list.length}
                className={`day-tab${active ? ' is-active' : ''}${isToday ? ' is-today' : ''}${list.length ? ' has-walks' : ''}`}
                onClick={() => pickDay(d)}
                data-testid={`day-${k}`}
              >
                {active && <motion.span layoutId={`day-${group}`} className="day-tab__bg" transition={{ type: 'spring', duration: 0.5, bounce: 0.18 }} />}
                <span className="day-tab__wd">{weekday.format(d)}</span>
                <span className="day-tab__n">{d.getDate()}</span>
                <span className="day-tab__bar" aria-hidden>
                  {list.slice(0, 3).map((w) => (
                    <i key={w.id} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
        <button type="button" className="icon-btn walk-cal__nav" aria-label={t('calendar.nextWeek')} onClick={() => setEnd(addDays(end, 7))} disabled={end >= today} data-testid="week-next">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="walk-cal__foot">
        <span className="small">{range}</span>
        <AnimatePresence mode="popLayout" initial={false}>
          {dayWalks.length > 1 && (
            <motion.div key={dayKey(selected)} className="walk-cal__times" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.3 }}>
              {dayWalks.map((w) => (
                <button key={w.id} type="button" className={`time-chip${w.id === current.id ? ' is-active' : ''}`} onClick={() => go(w)} aria-pressed={w.id === current.id}>
                  {formatTime(w.created_at, locale)}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function CalendarPopover({
  open,
  setOpen,
  byDay,
  selected,
  today,
  onPick,
}: {
  open: boolean
  setOpen: (v: boolean) => void
  byDay: Map<string, Walk[]>
  selected: Date
  today: Date
  onPick: (d: Date) => void
}) {
  const { t, locale } = useI18n()
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1))
  const root = useRef<HTMLDivElement>(null)
  const L = intlLocale(locale)

  // Закрытие по клику снаружи и Escape — как у выпадающих списков.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  // Неделя с понедельника; в английском — с воскресенья, как привыкли американские судьи.
  const firstDow = locale === 'en' ? 0 : 1
  const lead = (month.getDay() - firstDow + 7) % 7
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: (Date | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))]
  const head = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(L, { weekday: 'narrow' }).format(new Date(2024, 0, 7 + firstDow + i)))
  // Заглавная только первая буква: CSS capitalize превращал «2026 г.» в «2026 Г.»
  const title = capitalize(new Intl.DateTimeFormat(L, { month: 'long', year: 'numeric' }).format(month))
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1)

  return (
    <div className="cal-pop" ref={root}>
      <button
        type="button"
        className={`icon-btn icon-btn--outline walk-cal__open${open ? ' is-open' : ''}`}
        aria-label={t('calendar.open')}
        aria-expanded={open}
        onClick={() => {
          if (!open) setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1))
          setOpen(!open)
        }}
        data-testid="calendar-open"
      >
        <CalendarDays size={18} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="cal"
            role="dialog"
            aria-label={t('calendar.open')}
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            data-testid="calendar"
          >
            <div className="cal__head">
              <button type="button" className="icon-btn" aria-label={t('calendar.prevMonth')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                <ChevronLeft size={16} />
              </button>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={title} className="cal__title" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                  {title}
                </motion.span>
              </AnimatePresence>
              <button type="button" className="icon-btn" aria-label={t('calendar.nextMonth')} disabled={nextMonth > today} onClick={() => setMonth(nextMonth)}>
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="cal__grid" role="grid">
              {head.map((h, i) => (
                <span key={`h${i}`} className="cal__dow" aria-hidden>
                  {h}
                </span>
              ))}
              {cells.map((d, i) =>
                d ? (
                  <CalendarDay key={dayKey(d)} d={d} count={byDay.get(dayKey(d))?.length ?? 0} selected={dayKey(d) === dayKey(selected)} today={dayKey(d) === dayKey(today)} future={d.getTime() > today.getTime() + DAY - 1} onPick={onPick} />
                ) : (
                  <span key={`e${i}`} />
                ),
              )}
            </div>
            <p className="small cal__hint">{t('calendar.hint')}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CalendarDay({ d, count, selected, today, future, onPick }: { d: Date; count: number; selected: boolean; today: boolean; future: boolean; onPick: (d: Date) => void }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      className={`cal__day${count ? ' has-walks' : ''}${selected ? ' is-selected' : ''}${today ? ' is-today' : ''}${future ? ' is-future' : ''}`}
      disabled={!count}
      onClick={() => onPick(d)}
      aria-label={`${d.getDate()} · ${count ? t('calendar.walks', { n: count }) : t('calendar.noWalks')}`}
      data-testid={`cal-${dayKey(d)}`}
    >
      {d.getDate()}
      {count > 1 && <sup className="cal__count">{count}</sup>}
    </button>
  )
}
