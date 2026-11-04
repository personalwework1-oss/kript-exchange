import { Connection } from '@solana/web3.js';
import {
  EVM_NATIVE, JupiterProvider, SOL_MINT, SunSwapProvider, TOKENS, TRX_NATIVE, USDT, ZeroExProvider,
  type ChainId, type SwapProvider, type SwapToken,
} from '@kript/wallet-core';
import { NETWORK, RPC, TRONGRID_KEY } from '../config';

const env = process.env;

export interface SwapPair { chain: ChainId; token: SwapToken }

const NATIVE_PAIRS: Record<string, SwapPair> = {
  ETH: { chain: 'ethereum', token: { address: EVM_NATIVE, symbol: 'ETH', decimals: 18 } },
  BNB: { chain: 'bsc', token: { address: EVM_NATIVE, symbol: 'BNB', decimals: 18 } },
  POL: { chain: 'polygon', token: { address: EVM_NATIVE, symbol: 'POL', decimals: 18 } },
  SOL: { chain: 'solana', token: { address: SOL_MINT, symbol: 'SOL', decimals: 9 } },
  TRX: { chain: 'tron', token: { address: TRX_NATIVE, symbol: 'TRX', decimals: 6 } },
};

/** Every network where `symbol` can be traded against USDT (native coins + verified registry tokens). */
export function swapPairsFor(symbol: string): SwapPair[] {
  const out: SwapPair[] = [];
  if (NATIVE_PAIRS[symbol]) out.push(NATIVE_PAIRS[symbol]!);
  for (const t of TOKENS) {
    if (t.symbol !== symbol || t.symbol === 'USDT') continue;
    out.push({ chain: t.chain, token: { address: t.address, symbol: t.symbol, decimals: t.decimals } });
  }
  return out;
}

export function usdtToken(chain: Exclude<ChainId, 'bitcoin'>): SwapToken {
  const u = USDT[chain];
  return { address: u.address, symbol: 'USDT', decimals: u.decimals };
}

export const SWAPS_ENABLED = NETWORK === 'mainnet';

let zx: ZeroExProvider | null = null;
let jup: JupiterProvider | null = null;
let sun: SunSwapProvider | null = null;

export function swapProvider(chain: ChainId): SwapProvider | null {
  if (!SWAPS_ENABLED) return null;
  if (chain === 'tron') {
    if (!sun) sun = new SunSwapProvider({ fullHost: RPC.tron, apiKey: TRONGRID_KEY });
    return sun;
  }
  if (chain === 'solana') {
    if (!jup) {
      const ref = env.EXPO_PUBLIC_JUP_REFERRAL_ACCOUNT;
      jup = new JupiterProvider({
        connection: new Connection(RPC.solana, 'confirmed'),
        apiKey: env.EXPO_PUBLIC_JUP_API_KEY || undefined,
        referral: ref ? { account: ref, feeBps: Number(env.EXPO_PUBLIC_JUP_REFERRAL_BPS ?? 50) } : undefined,
      });
    }
    return jup;
  }
  if (chain === 'ethereum' || chain === 'bsc' || chain === 'polygon') {
    const key = env.EXPO_PUBLIC_0X_API_KEY;
    if (!key) return null;
    if (!zx) {
      const recipient = env.EXPO_PUBLIC_FEE_RECIPIENT_EVM;
      zx = new ZeroExProvider({
        apiKey: key,
        rpc: { ethereum: RPC.ethereum, bsc: RPC.bsc, polygon: RPC.polygon },
        fee: recipient ? { recipient, bps: Number(env.EXPO_PUBLIC_FEE_BPS ?? 30) } : undefined,
      });
    }
    return zx;
  }
  return null;
}
