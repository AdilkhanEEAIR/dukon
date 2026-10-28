// «Экспорт ▾»: PDF для печати и отправки, Excel с формулами итогов, CSV для учётных программ.
// Страница отдаёт только «как собрать таблицу», а язык, валюту, магазин и пометку «демо» меню берёт само —
// так файл всегда совпадает с тем, что человек видит на экране.

import { Download, FileDown, FileSpreadsheet, FileText } from 'lucide-react'
import { useState } from 'react'
import { useMode } from '../app/mode'
import { useSettings } from '../app/settings'
import { useViewShop } from '../app/shops'
import { useI18n } from '../i18n'
import { exportTable, type ExportContext, type ExportFormat, type ExportTable } from '../lib/export'
import { Dropdown } from './Dropdown'
import { useToast } from './Toast'

export function ExportMenu({ build, testId = 'export' }: { build: (ctx: ExportContext) => ExportTable; testId?: string }) {
  const { t, locale } = useI18n()
  const { settings } = useSettings()
  const { mode } = useMode()
  const { current } = useViewShop()
  const toast = useToast()
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  const run = async (format: ExportFormat) => {
    if (busy) return
    setBusy(format)
    try {
      const table = build({ locale, currency: settings.currency, now: new Date(), demo: mode === 'demo', shopName: current?.name ?? 'Dukon', shopAddress: current?.address || undefined })
      const name = await exportTable(table, format)
      toast('success', t('export.done'), name)
    } catch (err) {
      console.error('export failed', err)
      toast('danger', t('export.failed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dropdown<ExportFormat | 'none'>
      value="none"
      onChange={(v) => v !== 'none' && void run(v)}
      label={t('export.menu')}
      align="end"
      testId={testId}
      triggerClass="dd__trigger--btn"
      renderTrigger={() => (
        <span className={`export-trigger${busy ? ' is-busy' : ''}`} aria-busy={busy !== null || undefined}>
          {busy ? <span className="export-trigger__spin" aria-hidden /> : <Download size={15} aria-hidden />}
          <span className="export-trigger__text">{busy ? t('export.preparing') : t('export.button')}</span>
        </span>
      )}
      options={[
        { value: 'pdf', label: 'PDF', hint: t('export.pdfHint'), icon: <FileText size={17} /> },
        { value: 'xlsx', label: 'Excel', hint: t('export.xlsxHint'), icon: <FileSpreadsheet size={17} /> },
        { value: 'csv', label: 'CSV', hint: t('export.csvHint'), icon: <FileDown size={17} /> },
      ]}
    />
  )
}
