// Настройки: магазины и филиалы (на сервере), язык, валюта, тема, демо-код, код устройства, сброс.
// Удаление магазина — в два нажатия вместо системного confirm: диалог браузера блокирует страницу.

import { Check, Copy, Feather, Info, Link2, MapPin, MonitorSmartphone, Pencil, Plus, Sparkles, Store, Trash2, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { API_BASE, errorCode } from '../api/client'
import type { Shop } from '../api/types'
import { CURRENCIES, DEVICE_CODE, useSettings, type Currency, type MotionPref, type Theme } from '../app/settings'
import { useShops } from '../app/shops'
import { Button, IconButton } from '../components/Button'
import { Dropdown } from '../components/Dropdown'
import { ChoiceRow, Field, Input } from '../components/Fields'
import { AuthorLine, PageActions, REPO_URL } from '../components/Nav'
import { MoonGlyph, SunGlyph } from '../components/ThemeIcon'
import { useToast } from '../components/Toast'
import { DICTS, LOCALES, useI18n, type Locale } from '../i18n'
import { CURRENCY_LABEL } from '../lib/currency'

export function SettingsPage() {
  const { t, locale, setLocale } = useI18n()
  const { settings, update, reset, deviceId, setDeviceId, systemCalm } = useSettings()
  const toast = useToast()
  const navigate = useNavigate()
  const { hash } = useLocation()
  const [demoKey, setDemoKey] = useState(settings.demoKey)
  const [code, setCode] = useState('')

  // Переход «Добавить филиал» из переключателя магазина ведёт прямо к форме.
  useEffect(() => {
    if (hash === '#shops') document.getElementById('shops')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hash])

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(deviceId)
      toast('success', t('settings.copied'))
    } catch {
      toast('info', deviceId)
    }
  }

  const linkDevice = (e: FormEvent) => {
    e.preventDefault()
    const value = code.trim()
    if (!DEVICE_CODE.test(value)) {
      toast('danger', t('settings.invalidCode'))
      return
    }
    setDeviceId(value)
    setCode('')
    toast('success', t('settings.linked'))
  }

  return (
    <div className="page stagger" style={{ maxWidth: 680 }} data-testid="settings">
      <header className="page-head">
        <div className="page-head__text">
          <span className="small">{t('common.appName')}</span>
          <h1 className="h1">{t('settings.title')}</h1>
        </div>
        <PageActions />
      </header>

      <ShopsSection />

      <section className="sheet sheet--pad stack" style={{ gap: 16 }}>
        <h2 className="h3">{t('settings.appearance')}</h2>
        <div className="two-col two-col--even" style={{ gap: 14 }}>
          <Dropdown<Locale>
            visibleLabel
            block
            label={t('settings.language')}
            value={locale}
            onChange={setLocale}
            testId="settings-lang"
            options={LOCALES.map((l) => ({ value: l, label: DICTS[l].locale.name }))}
          />
          <Dropdown<Currency>
            visibleLabel
            block
            label={t('settings.currency')}
            value={settings.currency}
            onChange={(c) => update({ currency: c })}
            testId="settings-currency"
            options={CURRENCIES.map((c) => ({ value: c, label: c, hint: CURRENCY_LABEL[c] }))}
          />
        </div>
        <p className="small">{t('settings.currencyNote')}</p>
        <ChoiceRow<Theme>
          label={t('settings.appearance')}
          value={settings.theme}
          onChange={(v) => update({ theme: v })}
          items={[
            { key: 'light', label: t('theme.light'), icon: <SunGlyph size={18} /> },
            { key: 'dark', label: t('theme.dark'), icon: <MoonGlyph size={18} /> },
          ]}
        />
        <span className="field__label" style={{ marginBottom: -6 }}>{t('settings.motion')}</span>
        <ChoiceRow<MotionPref>
          label={t('settings.motion')}
          value={settings.motion}
          onChange={(v) => update({ motion: v })}
          items={[
            { key: 'auto', label: t('settings.motionAuto'), icon: <MonitorSmartphone size={18} /> },
            { key: 'full', label: t('settings.motionFull'), icon: <Sparkles size={18} /> },
            { key: 'calm', label: t('settings.motionCalm'), icon: <Feather size={18} /> },
          ]}
        />
        {systemCalm && settings.motion === 'auto' && (
          <p className="small" data-testid="motion-system-note">
            {t('settings.motionSystemCalm')}
          </p>
        )}
      </section>

      <section className="sheet sheet--pad stack" style={{ gap: 12 }}>
        <h2 className="h3">{t('settings.liveMode')}</h2>
        <Field label={t('settings.demoKey')} hint={t('settings.demoKeyBody')} htmlFor="s-key">
          <div className="row" style={{ gap: 8 }}>
            <Input id="s-key" value={demoKey} onChange={(e) => setDemoKey(e.target.value)} autoComplete="off" />
            <Button
              variant="secondary"
              disabled={demoKey === settings.demoKey}
              onClick={() => {
                update({ demoKey })
                toast('success', t('common.saved'))
              }}
              data-testid="save-demo-key"
            >
              {t('common.save')}
            </Button>
          </div>
        </Field>
        <div className="kv" style={{ padding: 0 }}>
          <span className="kv__k">{t('settings.server')}</span>
          <span className="mono">{API_BASE}</span>
        </div>
      </section>

      <section className="sheet sheet--pad stack" style={{ gap: 12 }}>
        <h2 className="h3">{t('settings.device')}</h2>
        <p className="small">{t('settings.deviceBody')}</p>
        <div className="code-box">
          <span className="grow" data-testid="device-code">
            {deviceId}
          </span>
          <IconButton label={t('settings.copy')} onClick={() => void copyCode()}>
            <Copy size={16} />
          </IconButton>
        </div>
        <form className="row" style={{ gap: 8, alignItems: 'flex-end' }} onSubmit={linkDevice}>
          <div className="grow">
            <Field label={t('settings.linkCode')} htmlFor="s-link">
              <Input id="s-link" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Button type="submit" variant="secondary" icon={<Link2 size={16} />} disabled={!code.trim()} data-testid="link-device">
            {t('settings.link')}
          </Button>
        </form>
      </section>

      <section className="sheet sheet--pad stack" style={{ gap: 10 }}>
        <h2 className="h3">{t('common.about')}</h2>
        <div className="row row--wrap" style={{ gap: 8 }}>
          <Button variant="secondary" to="/" icon={<Info size={16} />}>
            {t('common.about')}
          </Button>
          <a className="btn btn--quiet" href={REPO_URL} target="_blank" rel="noreferrer">
            <span className="btn__content">{t('common.sourceCode')}</span>
          </a>
        </div>
        <AuthorLine withAbout={false} />
      </section>

      <section className="sheet sheet--pad stack" style={{ gap: 10 }}>
        <h2 className="h3">{t('settings.danger')}</h2>
        <p className="small">{t('settings.resetBody')}</p>
        <div>
          <Button
            variant="danger"
            icon={<Trash2 size={16} />}
            onClick={() => {
              reset()
              toast('info', t('settings.resetDone'))
              navigate('/app/onboarding', { replace: true })
            }}
            data-testid="reset"
          >
            {t('settings.reset')}
          </Button>
        </div>
      </section>
    </div>
  )
}

function ShopsSection() {
  const { t } = useI18n()
  const toast = useToast()
  const { shops, current, select, create } = useShops()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await create(name.trim(), address.trim())
      setName('')
      setAddress('')
      toast('success', t('shops.added'))
    } catch (err) {
      toast('danger', t(`errors.${errorCode(err).code}.title`), t(`errors.${errorCode(err).code}.hint`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="shops" className="sheet sheet--pad stack" style={{ gap: 12, scrollMarginTop: 24 }} data-testid="shops-section">
      <div className="section__head">
        <h2 className="h3">{t('shops.title')}</h2>
        <span className="small">{t('shops.count', { n: shops.length })}</span>
      </div>
      <div className="rows">
        {shops.map((s) => (
          <ShopRow key={s.id} shop={s} isCurrent={current?.id === s.id} onSelect={() => select(s.id)} canDelete={shops.length > 1} />
        ))}
      </div>
      <form className="stack" style={{ gap: 10, paddingTop: 8, borderTop: '1px solid var(--line)' }} onSubmit={add}>
        <span style={{ fontWeight: 700 }}>{t('shops.addTitle')}</span>
        <div className="two-col two-col--even" style={{ gap: 10 }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('onboarding.shopPlaceholder')} aria-label={t('onboarding.shopName')} maxLength={60} data-testid="new-shop-name" />
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t('onboarding.addressPlaceholder')} aria-label={t('onboarding.address')} maxLength={120} />
        </div>
        <div>
          <Button type="submit" variant="secondary" icon={<Plus size={16} />} loading={busy} disabled={!name.trim()} data-testid="add-shop">
            {t('shops.add')}
          </Button>
        </div>
      </form>
    </section>
  )
}

function ShopRow({ shop, isCurrent, onSelect, canDelete }: { shop: Shop; isCurrent: boolean; onSelect: () => void; canDelete: boolean }) {
  const { t } = useI18n()
  const toast = useToast()
  const { update, remove } = useShops()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(shop.name)
  const [address, setAddress] = useState(shop.address)
  const [confirming, setConfirming] = useState(false)

  // Второе нажатие на «Удалить» засчитывается только в течение 3 секунд.
  useEffect(() => {
    if (!confirming) return
    const id = setTimeout(() => setConfirming(false), 3000)
    return () => clearTimeout(id)
  }, [confirming])

  const fail = (err: unknown) => toast('danger', t(`errors.${errorCode(err).code}.title`), t(`errors.${errorCode(err).code}.hint`))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await update(shop.id, { name: name.trim(), address: address.trim() })
      setEditing(false)
      toast('success', t('common.saved'))
    } catch (err) {
      fail(err)
    }
  }

  const onDelete = async () => {
    if (!canDelete) {
      toast('info', t('shops.keepOne'))
      return
    }
    if (!confirming) {
      setConfirming(true)
      return
    }
    try {
      await remove(shop.id)
      toast('success', t('shops.deleted'))
    } catch (err) {
      fail(err)
    }
  }

  if (editing) {
    return (
      <form className="stack" style={{ gap: 8, padding: '12px 0' }} onSubmit={save} data-testid="shop-edit">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('onboarding.shopName')} maxLength={60} />
        <Input value={address} onChange={(e) => setAddress(e.target.value)} aria-label={t('onboarding.address')} maxLength={120} />
        <div className="row" style={{ gap: 8 }}>
          <Button type="submit" size="sm" icon={<Check size={14} />} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
          <Button size="sm" variant="quiet" icon={<X size={14} />} onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="shop-card" data-testid="shop-row">
      <button type="button" className="shop-card__icon" onClick={onSelect} aria-label={shop.name} style={isCurrent ? undefined : { background: 'var(--surface-2)', color: 'var(--ink-3)' }}>
        <Store size={18} />
      </button>
      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
        <span className="row" style={{ gap: 8 }}>
          <span className="truncate" style={{ fontWeight: 700 }}>
            {shop.name}
          </span>
          {isCurrent && <Check size={15} className="c-accent" aria-label="current" />}
        </span>
        <span className="small row" style={{ gap: 4 }}>
          <MapPin size={12} />
          <span className="truncate">{shop.address || t('shops.noAddress')}</span>
        </span>
      </div>
      <div className="row" style={{ gap: 4 }}>
        <IconButton label={t('shops.edit')} onClick={() => setEditing(true)}>
          <Pencil size={16} />
        </IconButton>
        {confirming ? (
          <Button size="sm" variant="danger" onClick={() => void onDelete()} data-testid="confirm-delete">
            {t('shops.deleteConfirm')}
          </Button>
        ) : (
          <IconButton label={t('shops.delete')} onClick={() => void onDelete()} data-testid="delete-shop">
            <Trash2 size={16} />
          </IconButton>
        )}
      </div>
    </div>
  )
}

