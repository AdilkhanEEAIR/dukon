// Онбординг: магазин (название и адрес) сохраняется на сервере и привязывается к коду устройства;
// язык, валюта и тема — на устройстве и применяются сразу, чтобы человек видел результат выбора.

import { ArrowRight, CircleAlert, MapPin } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { errorCode } from '../api/client'
import { CURRENCIES, useSettings, type Currency, type Theme } from '../app/settings'
import { useMode } from '../app/mode'
import { useShops } from '../app/shops'
import { Button } from '../components/Button'
import { Dropdown } from '../components/Dropdown'
import { ChoiceRow, Field, Input } from '../components/Fields'
import { AuthorLine } from '../components/Nav'
import { DICTS, LOCALES, useI18n, type Locale } from '../i18n'
import { CURRENCY_LABEL } from '../lib/currency'
import { LogoMark } from '../components/Logo'
import { MoonGlyph, SunGlyph } from '../components/ThemeIcon'
import { LocationField } from '../components/map/LocationField'
import type { GeoPoint } from '../api/types'

export function OnboardingPage() {
  const { t, locale, setLocale } = useI18n()
  const { settings, update } = useSettings()
  const { create } = useShops()
  const { setView } = useMode()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [point, setPoint] = useState<GeoPoint | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setNameError(t('onboarding.shopRequired'))
      return
    }
    setSaving(true)
    setFailure(null)
    try {
      await create(name.trim(), address.trim(), point)
      // Завёл свой магазин — значит, хочет видеть своё, а не демо-сеть (даже если до этого смотрел демо).
      setView('live')
      navigate('/app', { replace: true })
    } catch (err) {
      setFailure(err)
    } finally {
      setSaving(false)
    }
  }

  const fail = failure ? errorCode(failure) : null

  return (
    <div className="app__main" style={{ maxWidth: 560, paddingTop: 40 }}>
      <form className="page stagger" onSubmit={submit} noValidate data-testid="onboarding">
        <LogoMark size={48} />
        <div className="stack stack--tight">
          <h1 className="h1">{t('onboarding.title')}</h1>
          <p className="lead">{t('onboarding.body')}</p>
        </div>

        <Field label={t('onboarding.shopName')} htmlFor="shop" hint={t('onboarding.shopHint')} error={nameError ?? undefined}>
          <Input
            id="shop"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (nameError) setNameError(null)
            }}
            placeholder={t('onboarding.shopPlaceholder')}
            aria-invalid={!!nameError}
            autoFocus
            maxLength={60}
          />
        </Field>

        <Field label={t('onboarding.address')} htmlFor="address" hint={t('onboarding.addressHint')}>
          <div className="input-icon">
            <MapPin size={16} className="input-icon__icon" aria-hidden />
            <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t('onboarding.addressPlaceholder')} maxLength={120} />
          </div>
        </Field>
        <LocationField point={point} address={address} onPoint={setPoint} onAddress={setAddress} />

        <div className="two-col two-col--even" style={{ gap: 14 }}>
          <Dropdown<Locale>
            visibleLabel
            block
            label={t('onboarding.language')}
            value={locale}
            onChange={setLocale}
            testId="onboarding-lang"
            options={LOCALES.map((l) => ({ value: l, label: DICTS[l].locale.name }))}
          />
          <Dropdown<Currency>
            visibleLabel
            block
            label={t('onboarding.currency')}
            value={settings.currency}
            onChange={(c) => update({ currency: c })}
            testId="onboarding-currency"
            options={CURRENCIES.map((c) => ({ value: c, label: c, hint: CURRENCY_LABEL[c] }))}
          />
        </div>

        <Field label={t('onboarding.theme')}>
          <ChoiceRow<Theme>
            label={t('onboarding.theme')}
            value={settings.theme}
            onChange={(v) => update({ theme: v })}
            items={[
              { key: 'light', label: t('theme.light'), icon: <SunGlyph size={18} /> },
              { key: 'dark', label: t('theme.dark'), icon: <MoonGlyph size={18} /> },
            ]}
          />
        </Field>

        {fail && (
          <div className="notice notice--out" role="alert" data-testid="onboarding-error" data-code={fail.code}>
            <CircleAlert size={18} className="notice__icon" />
            <div className="stack stack--tight grow">
              <span className="notice__title">{t(`errors.${fail.code}.title`)}</span>
              <span className="notice__text">{t(`errors.${fail.code}.hint`)}</span>
            </div>
          </div>
        )}

        <Button type="submit" size="lg" block loading={saving} icon={<ArrowRight size={18} />} className="nudge" data-testid="onboarding-submit">
          {t('onboarding.done')}
        </Button>
        <AuthorLine />
      </form>
    </div>
  )
}
