import { useState } from 'react';
import { Dashboard } from './pages/Dashboard';
import { PolymarketPage } from './pages/PolymarketPage';
import { HistoryPage } from './pages/HistoryPage';
import { EvaluationPage } from './pages/EvaluationPage';
import { HealthPage } from './pages/HealthPage';
import { NewsPage } from './pages/NewsPage';
import { I18nProvider, useI18n, type TranslationKey } from './lib/i18n';

type Page = 'dashboard' | 'news' | 'polymarket' | 'history' | 'evaluation' | 'health';

const NAV: Array<{ id: Page; labelKey: TranslationKey }> = [
  { id: 'dashboard', labelKey: 'nav.signal' },
  { id: 'news', labelKey: 'nav.news' },
  { id: 'polymarket', labelKey: 'nav.polymarket' },
  { id: 'history', labelKey: 'nav.history' },
  { id: 'evaluation', labelKey: 'nav.evaluation' },
  { id: 'health', labelKey: 'nav.health' },
];

function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="flex items-center gap-1 rounded-lg bg-card px-1 py-0.5 ring-1 ring-border" role="group" aria-label="Language">
      <button
        onClick={() => setLang('he')}
        className={`rounded px-2 py-1 text-xs font-semibold transition ${
          lang === 'he' ? 'bg-slate-200 text-surface' : 'text-slate-400 hover:text-slate-200'
        }`}
        lang="he"
      >
        עברית
      </button>
      <button
        onClick={() => setLang('en')}
        className={`rounded px-2 py-1 text-xs font-semibold transition ${
          lang === 'en' ? 'bg-slate-200 text-surface' : 'text-slate-400 hover:text-slate-200'
        }`}
        lang="en"
      >
        EN
      </button>
    </div>
  );
}

function AppShell() {
  const [page, setPage] = useState<Page>('dashboard');
  const { t } = useI18n();

  return (
    <div className="min-h-screen px-4 pb-16 pt-6 sm:px-6">
      <header className="mx-auto mb-8 flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-extrabold tracking-tight">₿ Direction</span>
          <span className="text-xs text-slate-500">{t('app.subtitle')}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <nav className="flex flex-wrap gap-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  page === n.id ? 'bg-card text-slate-100 ring-1 ring-border' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t(n.labelKey)}
              </button>
            ))}
          </nav>
          <LanguageToggle />
        </div>
      </header>
      <main>
        {page === 'dashboard' && <Dashboard />}
        {page === 'news' && <NewsPage />}
        {page === 'polymarket' && <PolymarketPage />}
        {page === 'history' && <HistoryPage />}
        {page === 'evaluation' && <EvaluationPage />}
        {page === 'health' && <HealthPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  );
}
