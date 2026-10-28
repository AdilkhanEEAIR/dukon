// «Живые» детали: всё, что меняется на глазах без нажатий. Счётчик потерь с барабанами цифр,
// часы с мигающим двоеточием и «3 мин назад», которое само стареет. Это не украшения ради украшений:
// владелец видит, что пустая полка стоит денег прямо сейчас, а данные — свежие.

import { AnimatePresence, motion } from 'motion/react'
import { useSettings } from '../app/settings'
import { useNow } from '../hooks/useNow'
import { useI18n, type Locale } from '../i18n'
import { fromKgs, type Currency } from '../lib/currency'
import { formatMoney, formatTime } from '../lib/format'

const DIGIT = { type: 'spring' as const, stiffness: 380, damping: 32 }

/** Число на барабанах: меняется только та цифра, что изменилась, и въезжает снизу, как в счётчике такси. */
export function Odometer({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  const chars = [...text]
  return (
    <span className={`odo${className ? ` ${className}` : ''}`} data-testid={testId}>
      {chars.map((c, i) => {
        // Ключ — позиция с конца: если слева добавится разряд, остальные барабаны не перезапускаются.
        const pos = chars.length - i
        if (!/\d/.test(c)) {
          return (
            <span key={`s${pos}`} className="odo__sep">
              {c}
            </span>
          )
        }
        return (
          <span key={`d${pos}`} className="odo__slot">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span key={c} className="odo__digit" initial={{ y: '90%', opacity: 0 }} animate={{ y: '0%', opacity: 1 }} exit={{ y: '-90%', opacity: 0 }} transition={DIGIT}>
                {c}
              </motion.span>
            </AnimatePresence>
          </span>
        )
      })}
    </span>
  )
}

/** Сколько знаков нужно, чтобы последняя цифра менялась примерно раз в секунду: в сомах 2–3, в долларах 4. */
export function meterDecimals(lossPerDayKgs: number, currency: Currency): number {
  const perSecond = fromKgs(lossPerDayKgs, currency) / 86_400
  if (perSecond <= 0) return 2
  return Math.min(4, Math.max(2, Math.ceil(-Math.log10(perSecond))))
}

/** Потери за сегодня: потери в день × доля суток, прошедшая с полуночи. Пустое место на полке стоило денег
 *  и до обхода — обход его только нашёл, поэтому считаем с начала дня, а не с момента съёмки. */
export function lostSoFar(lossPerDayKgs: number, now: number): number {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  return (lossPerDayKgs * Math.max(0, now - midnight.getTime())) / 86_400_000
}

/** Счётчик «Сегодня уже потеряно»: тикает каждую секунду, пока полки пустые. */
export function LossMeter({ lossPerDayKgs }: { lossPerDayKgs: number }) {
  const { t, rich, locale } = useI18n()
  const { settings } = useSettings()
  const now = useNow(1000)
  if (lossPerDayKgs <= 0) return null
  const decimals = meterDecimals(lossPerDayKgs, settings.currency)
  const text = formatMoney(lostSoFar(lossPerDayKgs, now), locale, settings.currency, { decimals })
  return (
    <div className="loss-meter" data-testid="loss-meter" role="timer" aria-label={`${t('home.lostToday')}: ${text}`}>
      <span className="loss-meter__head">
        <span className="rec-dot" aria-hidden />
        <span className="loss-meter__label">{rich('home.lostToday')}</span>
      </span>
      <Odometer text={text} className="loss-meter__value" testId="loss-meter-value" />
      <span className="loss-meter__hint">{t('home.lostTodayHint')}</span>
    </div>
  )
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
]

/** «3 ч назад», «только что» — по правилам языка, через Intl. */
export function timeAgo(at: string | number, now: number, locale: Locale): string {
  const then = typeof at === 'number' ? at : Date.parse(at)
  if (Number.isNaN(then)) return ''
  const sec = Math.round((then - now) / 1000)
  let rtf: Intl.RelativeTimeFormat
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  } catch {
    rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto', style: 'short' })
  }
  if (Math.abs(sec) < 45) return rtf.format(0, 'second')
  for (const [unit, size] of UNITS) {
    if (Math.abs(sec) >= size) return rtf.format(Math.round(sec / size), unit)
  }
  return rtf.format(0, 'second')
}

/** Подпись, которая стареет сама: первые минуты обновляется часто, потом — раз в минуту. */
export function TimeAgo({ at, className, label }: { at: string; className?: string; label?: (ago: string) => string }) {
  const { locale } = useI18n()
  const now = useNow(15_000)
  const ago = timeAgo(at, now, locale)
  return (
    <time className={className} dateTime={at} data-testid="time-ago">
      {label ? label(ago) : ago}
    </time>
  )
}

/** Часы в шапке: двоеточие мигает раз в секунду — экран дышит, даже когда ничего не происходит. */
export function Clock() {
  const { locale } = useI18n()
  const now = useNow(1000)
  const [h, ...rest] = formatTime(new Date(now), locale).split(':')
  return (
    <time className="clock" dateTime={new Date(now).toISOString()} data-testid="clock">
      {h}
      {rest.length > 0 && (
        <>
          <span className="clock__colon">
            :
          </span>
          {rest.join(':')}
        </>
      )}
    </time>
  )
}
