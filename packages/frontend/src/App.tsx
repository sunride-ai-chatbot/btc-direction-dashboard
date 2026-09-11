import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import {
  PulseIcon, NewspaperIcon, ScalesIcon, GaugeIcon, ClockCounterClockwiseIcon, FlaskIcon, HeartbeatIcon, type Icon,
} from '@phosphor-icons/react';
import { Dashboard } from './pages/Dashboard';
import { PolymarketPage } from './pages/PolymarketPage';
import { HealthPage } from './pages/HealthPage';
import { NewsPage } from './pages/NewsPage';
import { I18nProvider, useI18n, type TranslationKey } from './lib/i18n';
import { LiveProvider, useLive } from './lib/live';
import { Skeleton } from './components/ui';
import { TickerBar } from './components/TickerBar';

// Recharts / the chart engine are only needed on some pages — code-split them so the
// first paint stays light.
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const EvaluationPage = lazy(() => import('./pages/EvaluationPage').then((m) => ({ default: m.EvaluationPage })));
const DerivativesPage = lazy(() => import('./pages/DerivativesPage').then((m) => ({ default: m.DerivativesPage })));

function PageFallback() {
  return (
    <div className="mx-auto max-w-5xl">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-4 h-64 w-full rounded-xl" />
    </div>
  );
}

const NAV: Array<{ path: string; labelKey: TranslationKey; Icon: Icon }> = [
  { path: '/', labelKey: 'nav.signal', Icon: PulseIcon },
  { path: '/news', labelKey: 'nav.news', Icon: NewspaperIcon },
  { path: '/polymarket', labelKey: 'nav.polymarket', Icon: ScalesIcon },
  { path: '/derivatives', labelKey: 'nav.derivatives', Icon: GaugeIcon },
  { path: '/history', labelKey: 'nav.history', Icon: ClockCounterClockwiseIcon },
  { path: '/evaluation', labelKey: 'nav.evaluation', Icon: FlaskIcon },
  { path: '/health', labelKey: 'nav.health', Icon: HeartbeatIcon },
];

function LanguageToggle() {
  const { lang, setLang } = useI18n();
  const btn = (code: 'he' | 'en', label: string) => (
    <button
      onClick={() => setLang(code)}
      className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ${
        lang === code ? 'bg-accent text-white shadow-glow-accent' : 'text-slate-400 hover:bg-card-hover hover:text-slate-200'
      }`}
      aria-pressed={lang === code}
      lang={code}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-card/80 p-0.5 ring-1 ring-border" role="group" aria-label="Language">
      {btn('he', 'עברית')}
      {btn('en', 'EN')}
    </div>
  );
}

function Brand() {
  return (
    <span className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-slate-50">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-sm font-bold text-accent shadow-glow-accent" aria-hidden="true">
        ₿
      </span>
      Direction
    </span>
  );
}

function NavItems({ variant }: { variant: 'sidebar' | 'tabs' }) {
  const { t } = useI18n();
  return (
    <>
      {NAV.map(({ path, labelKey, Icon }) => (
        <NavLink
          key={path}
          to={path}
          end={path === '/'}
          className={({ isActive }) =>
            variant === 'sidebar'
              ? `flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                  isActive ? 'bg-accent/15 text-slate-50 shadow-glow-accent-sm' : 'text-slate-400 hover:bg-card-hover hover:text-slate-200'
                }`
              : `flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border-b-2 px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                  isActive ? 'border-accent bg-card text-slate-100 shadow-glow-accent-sm' : 'border-transparent text-slate-400 hover:bg-card/60 hover:text-slate-200'
                }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon weight={isActive ? 'fill' : 'regular'} className={variant === 'sidebar' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden="true" />
              {t(labelKey)}
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

function AppShell() {
  const { t } = useI18n();
  const live = useLive();
  const tone = live.lastMove === 'up' ? 'bull' : live.lastMove === 'down' ? 'bear' : undefined;

  return (
    <div className="min-h-screen lg:flex">
      <div className="aurora" data-tone={tone} aria-hidden="true" />
      <div className="hud-grid" aria-hidden="true" />
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-3 focus-visible:top-3 focus-visible:z-50 focus-visible:rounded-lg focus-visible:bg-accent focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-white"
      >
        {t('app.skipToContent')}
      </a>

      {/* Desktop: left rail */}
      <aside className="glass sticky top-0 z-40 hidden h-screen w-60 shrink-0 flex-col border-y-0 border-s-0 lg:flex">
        <div className="px-5 pb-4 pt-5">
          <Brand />
          <div className="mt-1 text-[11px] text-slate-500">{t('app.subtitle')}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3" aria-label={t('app.primaryNav')}>
          <NavItems variant="sidebar" />
        </nav>
        <div className="border-t border-border/60 px-4 py-4">
          <LanguageToggle />
        </div>
      </aside>

      {/* Mobile / tablet: compact top bar + scrollable tabs */}
      <header className="glass sticky top-0 z-40 border-x-0 border-t-0 lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <Brand />
          <LanguageToggle />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]" aria-label={t('app.primaryNav')}>
          <NavItems variant="tabs" />
        </nav>
      </header>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TickerBar />
        <main id="main" tabIndex={-1} className="relative flex-1 px-4 py-5 focus:outline-none sm:px-6 lg:px-8">
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
            <Route
              path="/derivatives"
              element={
                <Suspense fallback={<PageFallback />}>
                  <DerivativesPage />
                </Suspense>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <LiveProvider>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </LiveProvider>
    </I18nProvider>
  );
}
