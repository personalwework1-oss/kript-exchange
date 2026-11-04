import { useCallback, useEffect, useState } from 'react';
import { CHAINS, findToken, type Balances, type ChainId, type DerivedAccounts, type TokenRef } from '@kript/wallet-core';
import { adapter, addressOf, CHAIN_ORDER, usdtSupported } from './networks';
import { confirmOnChain, loadCustomTokens, registryTokens, tokenMeta, trustOf, type CustomToken, type TrustLevel } from './tokens';

export interface ChainBalance {
  chain: ChainId;
  balances?: Balances;
  error?: string;
}

export interface Holding {
  key: string;
  symbol: string;
  name?: string;
  chain: ChainId;
  amount: bigint;
  decimals: number;
  /** undefined for the native coin */
  token?: TokenRef;
  trust: TrustLevel;
  cgId?: string;
}

/** Native coin + all tokens across chains. One failing RPC does not hide the others. */
export function useBalances(accounts: DerivedAccounts | null) {
  const [rows, setRows] = useState<ChainBalance[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!accounts) return;
    setLoading(true);
    const custom = await loadCustomTokens();
    const perChain = await Promise.all(
      CHAIN_ORDER.map(async (chain): Promise<{ row: ChainBalance; hs: Holding[] }> => {
        const a = adapter(chain);
        const addr = addressOf(accounts, chain);
        try {
          const b = await a.getBalances(addr);
          if (!usdtSupported(chain)) delete b.usdt;
          const c = CHAINS[chain];
          const hs: Holding[] = [];
          if (b.native > 0n) hs.push({ key: `${chain}:native`, symbol: c.nativeSymbol, chain, amount: b.native, decimals: c.nativeDecimals, trust: 'verified' });
          if (chain !== 'bitcoin') hs.push(...(await tokenHoldings(chain, addr, custom)));
          return { row: { chain, balances: b }, hs };
        } catch (e) {
          return { row: { chain, error: e instanceof Error ? e.message : String(e) }, hs: [] };
        }
      }),
    );
    setRows(perChain.map((p) => p.row));
    setHoldings(perChain.flatMap((p) => p.hs));
    setLoading(false);
  }, [accounts]);

  useEffect(() => {
    load();
  }, [load]);

  return { rows, holdings, loading, reload: load };
}

async function tokenHoldings(chain: ChainId, owner: string, custom: CustomToken[]): Promise<Holding[]> {
  const a = adapter(chain);
  const reg = registryTokens(chain);
  const mine = custom.filter((t) => t.chain === chain);
  const known = [...reg.map((t) => t.address), ...mine.map((t) => t.address)];
  const [bal, discovered] = await Promise.all([
    a.getTokenBalances(owner, known).catch(() => ({} as Record<string, bigint>)),
    a.discoverTokens ? a.discoverTokens(owner).catch(() => []) : Promise.resolve([]),
  ]);
  const out: Holding[] = [];

  for (const t of reg) {
    const amount = bal[t.address] ?? 0n;
    if (amount <= 0n) continue;
    const ok = await confirmOnChain(t); // demote if on-chain data disagrees with the registry
    out.push({ key: `${chain}:${t.address}`, symbol: t.symbol, name: t.name, chain, amount, decimals: t.decimals,
      token: { address: t.address, decimals: t.decimals, symbol: t.symbol }, trust: ok ? 'verified' : 'suspicious', cgId: t.cgId });
  }
  for (const t of mine) {
    const amount = bal[t.address] ?? 0n;
    out.push({ key: `${chain}:${t.address}`, symbol: t.symbol, name: t.name, chain, amount, decimals: t.decimals,
      token: { address: t.address, decimals: t.decimals, symbol: t.symbol }, trust: trustOf(chain, t.address, t.symbol, custom) });
  }
  for (const d of discovered) {
    if (findToken(chain, d.address) || mine.some((t) => t.address === d.address)) continue;
    const meta = await tokenMeta(chain, d.address);
    if (!meta) continue;
    const symbol = (meta.symbol ?? `${d.address.slice(0, 4)}…${d.address.slice(-4)}`).slice(0, 16);
    out.push({ key: `${chain}:${d.address}`, symbol, name: meta.name, chain, amount: d.amount, decimals: meta.decimals,
      token: { address: d.address, decimals: meta.decimals, symbol }, trust: trustOf(chain, d.address, symbol, custom) });
  }
  return out;
}
