/** Holdings valued in USD — shared by «Главная» and «Активы». */
import { priceByCg, priceOf, useMarkets } from '../market/prices';
import { toNumber } from '../format';
import { useWallet } from './WalletProvider';
import { useBalances, type Holding } from './useBalances';

export type Valued = Holding & { usd?: number };

export function usePortfolio() {
  const { accounts } = useWallet();
  const bal = useBalances(accounts);
  const { data: markets } = useMarkets();
  const priced = (h: Holding) => {
    const p = h.cgId ? priceByCg(markets, h.cgId) : !h.token ? priceOf(markets, h.symbol) : undefined;
    return p !== undefined ? toNumber(h.amount, h.decimals) * p : undefined;
  };
  // Verified tokens and native coins are visible; unknown / suspicious ones are hidden behind a toggle.
  const visible = bal.holdings.filter((h) => h.trust === 'verified' || h.trust === 'custom');
  const hidden = bal.holdings.filter((h) => h.trust === 'unverified' || h.trust === 'suspicious');
  const valued: Valued[] = visible.map((h) => ({ ...h, usd: priced(h) })).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const total = valued.reduce((s, h) => s + (h.usd ?? 0), 0);
  // Today's PnL from 24h price change of what is held now (no trade history needed).
  const pnl = valued.reduce((s, h) => {
    const m = markets?.find((x) => (h.cgId ? x.coin.cgId === h.cgId : x.coin.symbol === h.symbol));
    if (!m || h.usd === undefined) return s;
    return s + h.usd - h.usd / (1 + m.change24h / 100);
  }, 0);
  const failed = bal.rows.filter((r) => r.error);
  return { ...bal, markets, valued, hidden, visible, total, pnl, pnlPct: total ? (pnl / (total - pnl)) * 100 : 0, failed };
}
