import { useState } from 'react';
import { Dashboard } from './pages/Dashboard';
import { PolymarketPage } from './pages/PolymarketPage';
import { HistoryPage } from './pages/HistoryPage';
import { EvaluationPage } from './pages/EvaluationPage';
import { HealthPage } from './pages/HealthPage';

type Page = 'dashboard' | 'polymarket' | 'history' | 'evaluation' | 'health';

const NAV: Array<{ id: Page; label: string }> = [
  { id: 'dashboard', label: 'Signal' },
  { id: 'polymarket', label: 'Polymarket' },
  { id: 'history', label: 'History' },
  { id: 'evaluation', label: 'Evaluation' },
  { id: 'health', label: 'Health' },
];

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');

  return (
    <div className="min-h-screen px-4 pb-16 pt-6 sm:px-6">
      <header className="mx-auto mb-8 flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-extrabold tracking-tight">₿ Direction</span>
          <span className="text-xs text-slate-500">market-signal dashboard</span>
        </div>
        <nav className="flex gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                page === n.id ? 'bg-card text-slate-100 ring-1 ring-border' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {page === 'dashboard' && <Dashboard />}
        {page === 'polymarket' && <PolymarketPage />}
        {page === 'history' && <HistoryPage />}
        {page === 'evaluation' && <EvaluationPage />}
        {page === 'health' && <HealthPage />}
      </main>
    </div>
  );
}
