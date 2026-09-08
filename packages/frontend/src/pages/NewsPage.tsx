import { timeAgo, useApi } from '../lib/api';
import type { NewsPayload, NewsPost } from '../lib/types';
import { useI18n, type TranslationKey } from '../lib/i18n';

const DIRECTION_STYLE = {
  BULLISH: 'text-bull',
  NEUTRAL: 'text-flat',
  BEARISH: 'text-bear',
};

const IMPACT_STYLE = {
  HIGH: 'border-bear/30 bg-bear/5 text-bear',
  MEDIUM: 'border-flat/30 bg-flat/5 text-flat',
  LOW: 'border-border bg-surface text-slate-400',
};

function Reaction({ post }: { post: NewsPost }) {
  const { t } = useI18n();
  const points = [
    ['15m', post.btcReaction.m15],
    ['1h', post.btcReaction.h1],
    ['4h', post.btcReaction.h4],
    ['24h', post.btcReaction.h24],
  ] as const;
  return (
    <div className="chart-ltr mt-3 flex flex-wrap gap-2 text-[11px]">
      <span className="text-slate-500">{t('news.btcReaction')}</span>
      {points.map(([label, value]) => (
        <span key={label} className="rounded bg-surface px-2 py-0.5 font-mono text-slate-300">
          {label}: {value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
        </span>
      ))}
    </div>
  );
}

export function NewsPage() {
  const { t, lang } = useI18n();
  const { data, error } = useApi<NewsPayload>('/api/news', 60_000);

  if (!data) return <div className="mt-24 text-center text-slate-500">{error ? t('news.unavailable') : t('news.loading')}</div>;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t('news.title')}</h2>
          <p className="mt-1 text-sm text-slate-400">{t('news.source')} · {t('signal.updated', { ago: timeAgo(data.timestamp, lang) })}</p>
        </div>
        <a href="https://coinmarketcap.com/community/profile/CMC_News/" target="_blank" rel="noreferrer" className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-slate-300 hover:text-white">
          @CMC_News ↗
        </a>
      </div>

      <section className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500">{t('news.currentSignal')}</div>
            <div className={`mt-1 text-2xl font-extrabold ${DIRECTION_STYLE[data.direction]}`}>
              {t(`label.${data.direction}` as TranslationKey)} <span className="font-mono text-base text-slate-400">{data.score >= 0 ? '+' : ''}{data.score}</span>
            </div>
          </div>
          <span className="rounded-full border border-sky-400/30 bg-sky-400/5 px-3 py-1 text-xs font-semibold text-sky-400">{t('news.trackingOnly')}</span>
        </div>
        <p className="mt-3 text-sm text-slate-400">{t('news.explainer')}</p>
      </section>

      <div className="mt-4 space-y-3">
        {data.posts.map((post) => (
          <article key={post.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase">
              <span className={`rounded border px-2 py-0.5 ${IMPACT_STYLE[post.impact]}`}>{t(`news.impact.${post.impact}` as TranslationKey)}</span>
              <span className="rounded bg-surface px-2 py-0.5 text-slate-400">{t(`news.category.${post.category}` as TranslationKey)}</span>
              <span className={DIRECTION_STYLE[post.direction]}>{t(`label.${post.direction}` as TranslationKey)} {post.sentimentScore >= 0 ? '+' : ''}{post.sentimentScore}</span>
              <span className="text-slate-600">{t('news.relevance', { n: post.relevance })}</span>
              <span className="ms-auto normal-case text-slate-500">{timeAgo(post.publishedTs, lang)}</span>
            </div>
            <p dir="ltr" className="mt-3 line-clamp-4 text-left text-sm leading-6 text-slate-300">{post.text}</p>
            <Reaction post={post} />
          </article>
        ))}
      </div>
    </div>
  );
}
