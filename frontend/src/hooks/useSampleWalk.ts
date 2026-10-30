// «Попробовать на примере»: обход по настоящей полке из Бишкека, которая лежит на сервере.
// Судье не нужны ни фото, ни код: первый разбор зовёт модели, дальше ответ из кэша — мгновенно и бесплатно.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useLatest } from '../app/data'
import { useMode } from '../app/mode'
import { useSettings } from '../app/settings'
import { useShops } from '../app/shops'
import { useToast } from '../components/Toast'
import { useI18n } from '../i18n'

export function useSampleWalk() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const { mode, setView, refresh } = useMode()
  const { deviceId } = useSettings()
  const { current } = useShops()
  const { reload } = useLatest()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const walk = await api.sampleWalk({ shopId: current?.id, deviceId })
      toast('success', t('scan.done'), t('scan.doneBody', { n: walk.photos.length }))
      if (mode === 'demo') setView('live')
      else void reload()
      void refresh()
      navigate(`/app/shelves/${walk.id}/seen`)
    } catch {
      toast('danger', t('scan.sampleFailed'))
      void refresh()
    } finally {
      setBusy(false)
    }
  }
  return { run, busy }
}
