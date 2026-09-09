import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { PolymarketPage } from './pages/PolymarketPage';
import { HealthPage } from './pages/HealthPage';
import { NewsPage } from './pages/NewsPage';
import { I18nProvider, useI18n, type TranslationKey } from './lib/i18n';
import { Skeleton } from './components/ui';

// Recharts (~150kB gzipped) is only needed on these two pages — code-split them so the
// Signal/News/Polymarket/Health tabs stay light on first load.
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const EvaluationPage = lazy(() => import('./pages/EvaluationPage').then((m) => ({ default: m.EvaluationPage })));

function PageFallback() {
  return (
    <div className="mx-auto max-w-5xl">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-4 h-64 w-full rounded-xl" />
    </div>
  );
}

const NAV: Array<{ path: string; labelKey: TranslationKey }> = [
  { path: '/', labelKey: 'nav.signal' },
  { path: '/news', labelKey: 'nav.news' },
  { path: '/polymarket', labelKey: 'nav.polymarket' },
  { path: '/history', labelKey: 'nav.history' },
  { path: '/evaluation', labelKey: 'nav.evaluation' },
  { path: '/health', labelKey: 'nav.health' },
];

function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-card p-0.5 ring-1 ring-border" role="group" aria-label="Language">
      <button
        onClick={() => setLang('he')}
        className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ${
          lang === 'he' ? 'bg-accent text-white shadow-glow-accent' : 'text-slate-400 hover:bg-card-hover hover:text-slate-200'
        }`}
        aria-pressed={lang === 'he'}
        lang="he"
      >
        עברית
      </button>
      <button
        onClick={() => setLang('en')}
        className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ${
          lang === 'en' ? 'bg-accent text-white shadow-glow-accent' : 'text-slate-400 hover:bg-card-hover hover:text-slate-200'
        }`}
        aria-pressed={lang === 'en'}
        lang="en"
      >
        EN
      </button>
    </div>
  );
}

function AppShell() {
  const { t } = useI18n();

  return (
    <div className="min-h-screen pb-16">
      <div className="hud-grid" aria-hidden="true" />
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-3 focus-visible:top-3 focus-visible:z-50 focus-visible:rounded-lg focus-visible:bg-accent focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-white"
      >
        {t('app.skipToContent')}
      </a>
      <header className="sticky top-0 z-40 border-b border-border/80 bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-2">
            <span className="flex items-center gap-1.5 text-lg font-bold tracking-tight text-slate-50">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-sm font-bold text-accent shadow-glow-accent"
                aria-hidden="true"
              >
                ₿
              </span>
              Direction
            </span>
            <span className="hidden text-xs text-slate-500 sm:inline">{t('app.subtitle')}</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <nav className="flex flex-wrap gap-1" aria-label={t('app.primaryNav')}>
              {NAV.map((n) => (
                <NavLink
                  key={n.path}
                  to={n.path}
                  end={n.path === '/'}
                  className={({ isActive }) =>
                    `cursor-pointer rounded-lg border-b-2 px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                      isActive
                        ? 'border-accent bg-card text-slate-100 shadow-glow-accent-sm'
                        : 'border-transparent text-slate-400 hover:bg-card/60 hover:text-slate-200'
                    }`
                  }
                >
                  {t(n.labelKey)}
                </NavLink>
              ))}
            </nav>
            <LanguageToggle />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="relative px-4 pt-6 sm:px-6 focus:outline-none">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/polymarket" element={<PolymarketPage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route
            path="/history"
            element={
              <Suspense fallback={<PageFallback />}>
                <HistoryPage />
              </Suspense>
            }
          />
          <Route
            path="/evaluation"
            element={
              <Suspense fallback={<PageFallback />}>
                <EvaluationPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </I18nProvider>
  );
}
