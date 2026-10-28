// Лендинг: продукт встречает первым, а не демо-обход. Один оркестрованный момент — полка с рамками;
// остальное спокойно: шаги с иконками, модели Meta, призыв открыть магазин, автор внизу.

import { ArrowRight, Bot, Camera, Code, Coins, ScanSearch, Store } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useShops } from '../app/shops'
import { Button } from '../components/Button'
import { AuthorLine, LangSwitch, REPO_URL, ThemeToggle } from '../components/Nav'
import { ShelfArt } from '../components/ShelfArt'
import { useI18n } from '../i18n'
import { LogoMark } from '../components/Logo'

const STEP_ICONS = [Camera, ScanSearch, Coins, Bot]

export function LandingPage() {
  const { t, list } = useI18n()
  const { shops } = useShops()
  const steps = list<{ title: string; body: string }>('landing.steps')
  const models = list<{ name: string; role: string }>('landing.models')
  const appTarget = shops.length ? '/app' : '/app/onboarding'

  return (
    <div className="app__main landing" data-testid="landing">
      <header className="landing__nav">
        <Link to="/" className="row" style={{ gap: 10 }}>
          <LogoMark />
          <span className="h3">{t('common.appName')}</span>
        </Link>
        <div className="row" style={{ gap: 8 }}>
          <LangSwitch compact align="end" />
          <ThemeToggle />
        </div>
      </header>

      <section className="hero">
        <div className="hero__copy stagger">
          <h1 className="display">{t('landing.heroTitle')}</h1>
          <p className="lead">{t('landing.heroBody')}</p>
          <div className="hero__actions">
            <Button size="lg" to={appTarget} icon={<ArrowRight size={18} />} className="nudge">
              {t('common.openApp')}
            </Button>
            <Button size="lg" variant="secondary" to="/app/shelves?demo=1">
              {t('common.seeDemo')}
            </Button>
          </div>
          <p className="hero__foot">{t('landing.heroFootnote')}</p>
        </div>
        <div className="hero__visual">
          <ShelfArt />
        </div>
      </section>

      <section className="section">
        <h2 className="h1">{t('landing.stepsTitle')}</h2>
        <div className="steps-grid stagger">
          {steps.map((s, i) => {
            const Icon = STEP_ICONS[i] ?? Store
            return (
              <article key={s.title} className="step-card">
                <span className="step-card__icon">
                  <Icon size={20} />
                </span>
                <span className="step-card__n">{i + 1}</span>
                <h3 className="h3">{s.title}</h3>
                <p className="body-2">{s.body}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="two-col" style={{ alignItems: 'start' }}>
        <div className="stack">
          <h2 className="h1">{t('landing.proofTitle')}</h2>
          <p className="lead">{t('landing.proofBody')}</p>
        </div>
        <div className="stack">
          <h3 className="h3">{t('landing.modelsTitle')}</h3>
          <div className="models">
            {models.map((m) => (
              <div key={m.name} className="model">
                <span className="h3">{m.name}</span>
                <span className="small">{m.role}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta">
        <h2 className="h1">{t('landing.ctaTitle')}</h2>
        <p className="cta__body">{t('landing.ctaBody')}</p>
        <Button variant="secondary" size="lg" to={appTarget} icon={<ArrowRight size={18} />} className="nudge">
          {t('common.openApp')}
        </Button>
      </section>

      <footer className="landing__footer" data-testid="landing-footer">
        <span>{t('landing.footer')}</span>
        <span className="row" style={{ gap: 14 }}>
          <AuthorLine withAbout={false} />
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="author__link">
            <Code size={14} />
            {t('common.sourceCode')}
          </a>
        </span>
      </footer>
    </div>
  )
}
