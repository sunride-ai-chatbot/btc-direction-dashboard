import { describe, expect, it } from 'vitest';
import { SignalDatabase } from '../src/db/database.js';
import { CmcNewsProvider, aggregateNews, classifyNews, parseCommunityResponse } from '../src/providers/cmcNews.js';

const SAMPLE = {
  data: {
    tweetDTOList: [
      {
        gravityId: '379046857',
        postTime: '1788513776171',
        owner: { handle: 'CMC_News' },
        textContent: 'BTC rose 4% as spot ETF inflows accelerated and institutional adoption expanded.',
      },
      {
        gravityId: 'ignored',
        postTime: '1788513776171',
        owner: { handle: 'SomeoneElse' },
        textContent: 'BTC rally',
      },
    ],
  },
};

describe('CMC News intelligence', () => {
  it('parses only the verified CMC_News feed and normalizes text', () => {
    const posts = parseCommunityResponse(SAMPLE, 1788514000000);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: '379046857', direction: 'BULLISH', category: 'institutional', impact: 'HIGH' });
    expect(posts[0].text).not.toContain('\n');
  });

  it('classifies bearish security/regulatory events', () => {
    const result = classifyNews('Bitcoin exchange hacked after regulator lawsuit; withdrawals halted.');
    expect(result.category).toBe('security');
    expect(result.direction).toBe('BEARISH');
    expect(result.relevance).toBeGreaterThanOrEqual(55);
  });

  it('weights recent relevant news more heavily than old posts', () => {
    const now = 2_000_000_000_000;
    const bullish = { ...parseCommunityResponse(SAMPLE, now)[0], publishedTs: now - 60_000, sentimentScore: 60 };
    const bearishOld = { ...bullish, id: 'old', publishedTs: now - 70 * 3_600_000, sentimentScore: -100 };
    expect(aggregateNews([bullish, bearishOld], now).direction).toBe('BULLISH');
  });

  it('persists posts and serves stale last-known data on a source failure', async () => {
    const db = new SignalDatabase(':memory:');
    const okFetch = async <T>() => SAMPLE as T;
    const provider = new CmcNewsProvider(db, okFetch);
    const first = await provider.fetchNews();
    expect(first.freshness).toBe('fresh');
    expect(db.getRecentNewsItems(5)).toHaveLength(1);

    const failFetch = async <T>(): Promise<T> => { throw new Error('offline'); };
    const fallbackProvider = new CmcNewsProvider(db, failFetch);
    const fallback = await fallbackProvider.fetchNews();
    expect(fallback.freshness).toBe('stale');
    expect(fallback.posts[0].id).toBe('379046857');
    db.close();
  });
});
