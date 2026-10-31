// Правила хозяина словами и числами. Их проверяет код на сервере, поэтому форма простая: лимит в день,
// запас в днях, дни без молочки, минимальная скидка за «побольше», запрещённые поставщики.
// Кнопка «Сохранить» появляется только когда что-то изменилось.

import { ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Rules, Supplier } from '../../api/types'
import { useI18n } from '../../i18n'
import { supplierTitle, weekdayName } from '../../lib/agentText'
import { Button } from '../Button'
import { Field, NumberInput } from '../Fields'

const DAYS = [0, 1, 2, 3, 4, 5, 6]

export function RulesCard({ rules, suppliers, onSave, saving }: { rules: Rules; suppliers: Supplier[]; onSave: (r: Rules) => Promise<void> | void; saving?: boolean }) {
  const { t, locale } = useI18n()
  const [draft, setDraft] = useState<Rules>(rules)
  useEffect(() => setDraft(rules), [rules])
  const dirty = JSON.stringify(draft) !== JSON.stringify(rules)
  const num = (key: keyof Rules) => (v: number) => setDraft((d) => ({ ...d, [key]: v }))
  const toggleDay = (day: number) => setDraft((d) => ({ ...d, no_dairy_on: d.no_dairy_on.includes(day) ? d.no_dairy_on.filter((x) => x !== day) : [...d.no_dairy_on, day].sort() }))
  const toggleSupplier = (id: string) => setDraft((d) => ({ ...d, banned_suppliers: d.banned_suppliers.includes(id) ? d.banned_suppliers.filter((x) => x !== id) : [...d.banned_suppliers, id] }))

  return (
    <section className="sheet sheet--pad stack" style={{ gap: 12 }} data-testid="rules-card">
      <div className="row" style={{ gap: 8 }}>
        <ShieldCheck size={18} className="c-accent" />
        <span className="h3">{t('agent.rulesTitle')}</span>
      </div>
      <p className="small">{t('agent.rulesHint')}</p>
      <div className="rules-grid">
        <Field label={t('agent.fields.total')} htmlFor="rule-total">
          <NumberInput id="rule-total" min={0} max={10_000_000} value={draft.max_order_total_kgs} onChange={num('max_order_total_kgs')} data-testid="rule-total" />
        </Field>
        <Field label={t('agent.fields.days')} htmlFor="rule-days">
          <NumberInput id="rule-days" min={1} max={90} value={draft.max_stock_days} onChange={num('max_stock_days')} data-testid="rule-days" />
        </Field>
        <Field label={t('agent.fields.line')} htmlFor="rule-line">
          <NumberInput id="rule-line" min={1} max={100_000} value={draft.max_line_units} onChange={num('max_line_units')} data-testid="rule-line" />
        </Field>
        <Field label={t('agent.fields.discount')} htmlFor="rule-discount">
          <NumberInput id="rule-discount" min={0} max={100} decimals value={draft.min_discount_for_upsize_pct} onChange={num('min_discount_for_upsize_pct')} data-testid="rule-discount" />
        </Field>
      </div>
      <div className="field">
        <span className="field__label">{t('agent.fields.dairy')}</span>
        <div className="chips" role="group" aria-label={t('agent.fields.dairy')}>
          {DAYS.map((d) => (
            <button key={d} type="button" className={`chip${draft.no_dairy_on.includes(d) ? ' is-on' : ''}`} aria-pressed={draft.no_dairy_on.includes(d)} onClick={() => toggleDay(d)} data-testid={`dairy-day-${d}`}>
              {weekdayName(d, locale, 'short')}
            </button>
          ))}
        </div>
      </div>
      {suppliers.length > 0 && (
        <div className="field">
          <span className="field__label">{t('agent.fields.banned')}</span>
          <div className="chips" role="group" aria-label={t('agent.fields.banned')}>
            {suppliers.map((s) => (
              <button key={s.id} type="button" className={`chip chip--ban${draft.banned_suppliers.includes(s.id) ? ' is-on' : ''}`} aria-pressed={draft.banned_suppliers.includes(s.id)} onClick={() => toggleSupplier(s.id)}>
                {supplierTitle(s, locale)}
              </button>
            ))}
          </div>
        </div>
      )}
      {dirty && (
        <Button size="sm" loading={saving} onClick={() => void onSave(draft)} data-testid="save-rules">
          {t('agent.save')}
        </Button>
      )}
    </section>
  )
}
