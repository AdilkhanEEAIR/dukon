// Кнопка в правом нижнем углу: «живые данные ↔ демо». В живом режиме — тихий кружок с колбой,
// надпись «Показать демо» выезжает только при наведении, чтобы слово «демо» не висело на экране.
// В демо — развёрнутая плашка «Демо-данные · Вернуть мои данные». Сервер лежит — плашка «Сервер недоступен»,
// нажатие проверяет связь ещё раз. Смена режима сопровождается тостом, переходы самого режима
// (упал сервер, вернулся) — тоже.

import { ArrowLeftRight, FlaskConical, RefreshCw, WifiOff } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMode } from '../app/mode'
import { useI18n } from '../i18n'
import { useToast } from './Toast'

const SPRING = { type: 'spring' as const, bounce: 0.18, duration: 0.7 }

export function DataModeSwitch() {
  const { t } = useI18n()
  const { mode, status, reachable, setView, refresh } = useMode()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const toast = useToast()
  useModeToasts()

  if (status === 'loading') return null

  const leaveForeignReport = () => {
    // Отчёт конкретного обхода принадлежит старому набору данных — уводим на последний обход нового.
    if (pathname.startsWith('/app/shelves/') || pathname.startsWith('/app/item/')) navigate('/app/shelves')
  }

  const toDemo = () => {
    setView('demo')
    leaveForeignReport()
    toast('info', t('mode.toast.demo'), t('mode.toast.demoBody'))
  }
  const toLive = () => {
    setView('live')
    leaveForeignReport()
    toast('success', t('mode.toast.live'), t('mode.toast.liveBody'))
  }

  const state = !reachable ? 'down' : mode
  const label = state === 'down' ? `${t('mode.switch.serverDown')} · ${t('common.retry')}` : state === 'demo' ? t('mode.switch.toLive') : t('mode.switch.toDemo')

  return (
    <motion.div
      className="data-switch-wrap"
      initial={{ opacity: 0, y: 18, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { ...SPRING, delay: 0.6 } }}
      role="group"
      aria-label={t('mode.switch.label')}
    >
      <motion.button
        layout
        transition={SPRING}
        type="button"
        className={`data-switch data-switch--${state}`}
        data-testid="data-switch"
        data-state={state}
        aria-label={label}
        title={label}
        onClick={state === 'down' ? () => void refresh() : state === 'demo' ? toLive : toDemo}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {state === 'live' && (
            <motion.span key="live" className="data-switch__inner" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={SPRING}>
              <span className="data-switch__icon">
                <FlaskConical size={18} />
              </span>
              <span className="data-switch__reveal">{t('mode.switch.toDemo')}</span>
            </motion.span>
          )}
          {state === 'demo' && (
            <motion.span key="demo" className="data-switch__inner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={SPRING}>
              <span className="data-switch__tag">
                <FlaskConical size={15} />
                <span className="data-switch__tag-text">{t('mode.switch.demoOn')}</span>
              </span>
              <span className="data-switch__action">
                <ArrowLeftRight size={15} />
                {t('mode.switch.toLive')}
              </span>
            </motion.span>
          )}
          {state === 'down' && (
            <motion.span key="down" className="data-switch__inner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={SPRING}>
              <span className="data-switch__tag">
                <WifiOff size={15} />
                <span className="data-switch__tag-text">{t('mode.switch.demoOn')}</span>
              </span>
              <span className="data-switch__action">
                <RefreshCw size={14} className="data-switch__spin" />
                {t('mode.switch.serverDown')}
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </motion.div>
  )
}

/** Тосты на переходы, которые случились сами: сервер упал — показываем демо; вернулся — снова свои данные. */
function useModeToasts() {
  const { t } = useI18n()
  const toast = useToast()
  const { status, mode } = useMode()
  const prev = useRef(status)
  const view = useRef(mode)
  useEffect(() => {
    view.current = mode
  }, [mode])
  useEffect(() => {
    const was = prev.current
    prev.current = status
    if (was === 'ready' && status === 'down') toast('info', t('mode.toast.down'), t('mode.toast.downBody'))
    // Владелец сам выбрал демо — «снова ваши данные» было бы неправдой, говорим только, что связь вернулась.
    if (was === 'down' && status === 'ready') toast('success', t('mode.toast.back'), view.current === 'live' ? t('mode.toast.backBody') : undefined)
  }, [status, toast, t])
}
