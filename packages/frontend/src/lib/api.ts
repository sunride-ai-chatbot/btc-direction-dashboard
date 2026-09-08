import { useEffect, useRef, useState } from 'react';

/**
 * Backend base URL. Empty (default) = same origin + Vite dev proxy.
 * Production builds set VITE_API_BASE_URL to the deployed backend URL.
 */
export const API_BASE: string = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return API_BASE + path;
}

export function useApi<T>(path: string, refreshMs: number): { data: T | null; error: string | null; lastFetched: number | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const res = await fetch(apiUrl(path));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (!cancelled) {
          setData(json);
          setError(null);
          setLastFetched(Date.now());
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'fetch failed');
      }
    }

    void load();
    timerRef.current = window.setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [path, refreshMs]);

  return { data, error, lastFetched };
}

import { translate, type Lang } from './i18n';
import type { StreamTick } from './types';

export interface LiveStreamState {
  tick: StreamTick | null;
  connected: boolean;
  /** Direction of the last price change, for a brief flash; null when unchanged. */
  lastMove: 'up' | 'down' | null;
  signalVersion: number;
}

/**
 * Server-Sent Events subscription to the backend's live consensus price.
 * EventSource reconnects on its own; `connected` flips false meanwhile so the
 * UI can fall back to the polled price and say so.
 */
export function useLiveStream(): LiveStreamState {
  const [state, setState] = useState<LiveStreamState>({ tick: null, connected: false, lastMove: null, signalVersion: 0 });
  const lastPriceRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(apiUrl('/api/stream'));
    es.onopen = () => setState((s) => ({ ...s, connected: true }));
    es.onerror = () => setState((s) => ({ ...s, connected: false }));
    es.addEventListener('tick', (ev) => {
      try {
        const tick = JSON.parse((ev as MessageEvent).data) as StreamTick;
        const prev = lastPriceRef.current;
        const move = tick.price !== null && prev !== null && tick.price !== prev ? (tick.price > prev ? 'up' : 'down') : null;
        if (tick.price !== null) lastPriceRef.current = tick.price;
        setState((s) => ({ ...s, tick, connected: true, lastMove: move ?? s.lastMove }));
      } catch {
        // malformed frame — ignore
      }
    });
    es.addEventListener('signal', () => {
      setState((s) => ({ ...s, signalVersion: s.signalVersion + 1 }));
    });
    return () => es.close();
  }, []);

  return state;
}

export function timeAgo(ts: number, lang: Lang = 'en'): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return translate(lang, 'time.justNow');
  if (seconds < 60) return translate(lang, 'time.secondsAgo', { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return translate(lang, 'time.minutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return translate(lang, 'time.hoursAgo', { n: hours });
  return translate(lang, 'time.daysAgo', { n: Math.floor(hours / 24) });
}

export function formatUsd(value: number, compact = false): string {
  if (compact && Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (compact && Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}k`;
  }
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function israelTime(ts: number, lang: Lang = 'en'): string {
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  }).format(new Date(ts));
}
