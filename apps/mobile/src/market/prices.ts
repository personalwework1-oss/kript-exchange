/**
 * Market data. Stage 2 talks to CoinGecko's public API directly; in production
 * this moves behind our backend (caching, websockets, no rate-limit surprises).
 */
import { useCallback, useEffect, useState } from 'react';
import { TOKENS, type ChainId } from '@kript/wallet-core';

export interface Coin {
  symbol: string;
  name: string;
  cgId: string;
  color: string;
  glyph: string;
  /** Network where the user can hold it in this wallet, if any */
  chain?: ChainId;
}

export const COINS: Coin[] = [
  { symbol: 'BTC', name: 'Bitcoin', cgId: 'bitcoin', color: '#F7931A', glyph: '₿', chain: 'bitcoin' },
  { symbol: 'ETH', name: 'Ethereum', cgId: 'ethereum', color: '#627EEA', glyph: 'Ξ', chain: 'ethereum' },
  { symbol: 'SOL', name: 'Solana', cgId: 'solana', color: '#9945FF', glyph: '◎', chain: 'solana' },
  { symbol: 'BNB', name: 'BNB', cgId: 'binancecoin', color: '#F3BA2F', glyph: 'B', chain: 'bsc' },
  { symbol: 'TRX', name: 'Tron', cgId: 'tron', color: '#EF0027', glyph: 'T', chain: 'tron' },
  { symbol: 'POL', name: 'Polygon', cgId: 'polygon-ecosystem-token', color: '#8247E5', glyph: 'P', chain: 'polygon' },
  { symbol: 'XRP', name: 'XRP', cgId: 'ripple', color: '#23292F', glyph: 'X' },
  { symbol: 'TON', name: 'Toncoin', cgId: 'the-open-network', color: '#0098EA', glyph: 'T' },
  { symbol: 'DOGE', name: 'Dogecoin', cgId: 'dogecoin', color: '#C2A633', glyph: 'Ð' },
  { symbol: 'LINK', name: 'Chainlink', cgId: 'chainlink', color: '#2A5ADA', glyph: 'L' },
];

export const USDT_COIN: Coin = { symbol: 'USDT', name: 'Tether', cgId: 'tether', color: '#26A17B', glyph: '₮' };

/** Tokens from the verified registry, one market per CoinGecko id. */
const SKIP = new Set(['tether', 'weth']);
export const TOKEN_COINS: Coin[] = TOKENS.filter((t) => t.cgId && !SKIP.has(t.cgId))
  .filter((t, i, a) => a.findIndex((x) => x.cgId === t.cgId) === i)
  .filter((t) => !COINS.some((c) => c.cgId === t.cgId))
  .map((t) => ({ symbol: t.symbol, name: t.name, cgId: t.cgId!, color: t.color ?? '#3A3F4B', glyph: t.glyph ?? t.symbol[0]! }));

export const ALL_COINS: Coin[] = [...COINS, ...TOKEN_COINS];

export interface Market {
  coin: Coin;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  marketCap: number;
  sparkline: number[];
}

const CG = 'https://api.coingecko.com/api/v3';

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

interface CgMarket {
  id: string;
  current_price: number;
  price_change_percentage_24h: number | null;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  market_cap: number;
  sparkline_in_7d?: { price: number[] };
}

export async function fetchMarkets(): Promise<Market[]> {
  const ids = [...ALL_COINS, USDT_COIN].map((c) => c.cgId).join(',');
  const rows = await getJson<CgMarket[]>(
    `${CG}/coins/markets?vs_currency=usd&ids=${ids}&sparkline=true&price_change_percentage=24h`,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return [...ALL_COINS, USDT_COIN].flatMap((coin) => {
    const r = byId.get(coin.cgId);
    if (!r) return [];
    const spark = r.sparkline_in_7d?.price ?? [];
    return [{
      coin,
      price: r.current_price,
      change24h: r.price_change_percentage_24h ?? 0,
      volume24h: r.total_volume,
      high24h: r.high_24h,
      low24h: r.low_24h,
      marketCap: r.market_cap ?? 0,
      sparkline: spark.slice(-24), // last ~24h of hourly points
    }];
  });
}

export type Candle = { t: number; o: number; h: number; l: number; c: number };

/** days: 1 -> 30-min candles, 7/14/30 -> 4h candles, 90+ -> daily */
export async function fetchCandles(cgId: string, days: 1 | 7 | 30 | 90 | 365): Promise<Candle[]> {
  const rows = await getJson<number[][]>(`${CG}/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`);
  return rows.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
}

/** Refreshing markets hook (every 30 s). */
export function useMarkets() {
  const [data, setData] = useState<Market[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await fetchMarkets());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);
  return { data, error, reload: load };
}

export function priceByCg(markets: Market[] | null, cgId: string): number | undefined {
  return markets?.find((m) => m.coin.cgId === cgId)?.price;
}

export function priceOf(markets: Market[] | null, symbol: string): number | undefined {
  if (symbol === 'USDT') return markets?.find((m) => m.coin.symbol === 'USDT')?.price ?? 1;
  return markets?.find((m) => m.coin.symbol === symbol)?.price;
}

/** Networks where this coin can be held/traded in the wallet (native chain + verified token deployments). */
export function chainsOf(coin: Coin): ChainId[] {
  const set = new Set<ChainId>();
  if (coin.chain) set.add(coin.chain);
  for (const t of TOKENS) if (t.cgId === coin.cgId) set.add(t.chain);
  return [...set];
}
