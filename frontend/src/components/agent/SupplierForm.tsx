// Свой поставщик хозяина: имя, настоящий номер WhatsApp, категории, дни доставки, минималка.
// Форма простая и одна на «добавить» и «изменить»: поставщиков у магазина у дома пять-семь, не сотни.
// Телефон проверяем здесь же (8–15 цифр), чтобы агент не писал в пустоту.

import { useState } from 'react'
import type { Category, Supplier, SupplierChannel, SupplierIn } from '../../api/types'
import { useI18n } from '../../i18n'
import { weekdayName } from '../../lib/agentText'
import { Button } from '../Button'
import { Field, Input, NumberInput, Select } from '../Fields'

const DAYS = [0, 1, 2, 3, 4, 5, 6]
const CATEGORIES: Category[] = ['drinks', 'dairy', 'snacks', 'bread', 'grocery']

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, '')
}

function toForm(s?: Supplier | null): SupplierIn {
  return {
    name: s?.name ?? '',
    contact: s?.contact ?? '',
    phone: s?.phone ?? '',
    categories: s?.categories ?? ['snacks'],
    delivery_days: s?.delivery_days ?? [0, 1, 2, 3, 4, 5, 6],
    min_order_kgs: s?.min_order_kgs ?? 0,
    pack_size: s?.custom ? s.pack_size : 0,
    channel: s?.channel && s.channel !== 'simulated' ? s.channel : 'link',
  }
}

export function SupplierForm({ initial, onSave, onCancel, saving }: { initial?: Supplier | null; onSave: (body: SupplierIn) => Promise<void> | void; onCancel: () => void; saving?: boolean }) {
  const { t, locale } = useI18n()
  const [draft, setDraft] = useState<SupplierIn>(() => toForm(initial))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof SupplierIn>(key: K, value: SupplierIn[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const toggle = <K extends 'delivery_days' | 'categories'>(key: K, value: SupplierIn[K][number]) =>
    setDraft((d) => {
      const list = d[key] as unknown[]
      const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
      return { ...d, [key]: key === 'delivery_days' ? (next as number[]).sort((a, b) => a - b) : next }
    })
  const phoneOk = draft.phone.trim() === '' ? draft.channel === 'simulated' : phoneDigits(draft.phone).length >= 8 && phoneDigits(draft.phone).length <= 15
  const valid = draft.name.trim().length > 0 && draft.categories.length > 0 && draft.delivery_days.length > 0 && phoneOk

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!phoneOk) {
      setError(t('agent.supplierForm.invalidPhone'))
      return
    }
    if (!valid) return
    setError(null)
    void onSave({ ...draft, name: draft.name.trim(), contact: draft.contact?.trim(), phone: draft.phone.trim() ? `+${phoneDigits(draft.phone)}` : '' })
  }

  return (
    <form className="stack supplier-form" style={{ gap: 10 }} onSubmit={submit} data-testid="supplier-form">
      <div className="rules-grid">
        <Field label={t('agent.supplierForm.name')} htmlFor="sup-name">
          <Input id="sup-name" value={draft.name} maxLength={60} onChange={(e) => set('name', e.target.value)} placeholder="Jerry's Snacks & Sweets" data-testid="sup-name" required />
        </Field>
        <Field label={t('agent.supplierForm.contact')} htmlFor="sup-contact">
          <Input id="sup-contact" value={draft.contact ?? ''} maxLength={40} onChange={(e) => set('contact', e.target.value)} placeholder="Jerry" />
        </Field>
        <Field label={t('agent.supplierForm.phone')} hint={t('agent.supplierForm.phoneHint')} error={error ?? undefined} htmlFor="sup-phone">
          <Input id="sup-phone" type="tel" inputMode="tel" value={draft.phone} maxLength={20} onChange={(e) => set('phone', e.target.value)} placeholder="+996 555 123 456" data-testid="sup-phone" />
        </Field>
        <Field label={t('agent.supplierForm.channel')} htmlFor="sup-channel">
          <Select id="sup-channel" value={draft.channel} onChange={(e) => set('channel', e.target.value as SupplierChannel)} data-testid="sup-channel">
            <option value="link">{t('agent.supplierForm.channelLink')}</option>
            <option value="whatsapp">{t('agent.supplierForm.channelApi')}</option>
            <option value="simulated">{t('agent.supplierForm.channelSim')}</option>
          </Select>
        </Field>
        <Field label={t('agent.supplierForm.minOrder')} htmlFor="sup-min">
          <NumberInput id="sup-min" min={0} max={10_000_000} value={draft.min_order_kgs} onChange={(v) => set('min_order_kgs', v)} data-testid="sup-min" />
        </Field>
        <Field label={t('agent.supplierForm.pack')} htmlFor="sup-pack">
          <NumberInput id="sup-pack" min={0} max={1000} value={draft.pack_size ?? 0} onChange={(v) => set('pack_size', v)} data-testid="sup-pack" />
        </Field>
      </div>
      <div className="field">
        <span className="field__label">{t('agent.supplierForm.categories')}</span>
        <div className="chips" role="group" aria-label={t('agent.supplierForm.categories')}>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className={`chip${draft.categories.includes(c) ? ' is-on' : ''}`} aria-pressed={draft.categories.includes(c)} onClick={() => toggle('categories', c)} data-testid={`sup-cat-${c}`}>
              {t(`categories.${c}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field__label">{t('agent.supplierForm.days')}</span>
        <div className="chips" role="group" aria-label={t('agent.supplierForm.days')}>
          {DAYS.map((d) => (
            <button key={d} type="button" className={`chip${draft.delivery_days.includes(d) ? ' is-on' : ''}`} aria-pressed={draft.delivery_days.includes(d)} onClick={() => toggle('delivery_days', d)} data-testid={`sup-day-${d}`}>
              {weekdayName(d, locale, 'short')}
            </button>
          ))}
        </div>
      </div>
      <div className="row row--wrap" style={{ gap: 8 }}>
        <Button size="sm" type="submit" loading={saving} disabled={!valid && !draft.phone} data-testid="sup-save">
          {t('agent.supplierForm.save')}
        </Button>
        <Button size="sm" variant="quiet" type="button" onClick={onCancel}>
          {t('agent.supplierForm.cancel')}
        </Button>
      </div>
    </form>
  )
}
