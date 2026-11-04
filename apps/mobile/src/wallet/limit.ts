import { COW_NATIVE, CowLimitOrders, USDT, type ChainId, type LimitToken } from '@kript/wallet-core';
import { NETWORK, RPC, TESTNET } from '../config';

const env = process.env;

/** Coins tradable with limit orders against USDT (CoW: Ethereum, BNB Chain, Polygon; Sepolia in testnet). */
export const LIMIT_PAIRS: Record<string, { chain: ChainId; token: LimitToken }> = {
  ETH: { chain: 'ethereum', token: { address: COW_NATIVE, symbol: 'ETH', decimals: 18 } },
  LINK: { chain: 'ethereum', token: { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', decimals: 18 } },
  BNB: { chain: 'bsc', token: { address: COW_NATIVE, symbol: 'BNB', decimals: 18 } },
  POL: { chain: 'polygon', token: { address: COW_NATIVE, symbol: 'POL', decimals: 18 } },
};

export function limitUsdt(chain: ChainId): LimitToken | null {
  if (NETWORK === 'testnet') {
    return chain === 'ethereum' && TESTNET.ethereum.usdt ? { address: TESTNET.ethereum.usdt, symbol: 'USDT', decimals: 6 } : null;
  }
  if (chain === 'bitcoin') return null;
  const u = USDT[chain];
  return { address: u.address, symbol: 'USDT', decimals: u.decimals };
}

let cow: CowLimitOrders | null = null;
export function cowOrders(): CowLimitOrders {
  if (!cow) {
    const recipient = env.EXPO_PUBLIC_FEE_RECIPIENT_EVM;
    const bps = Number(env.EXPO_PUBLIC_COW_FEE_BPS ?? 0);
    cow = new CowLimitOrders({
      rpc: { ethereum: RPC.ethereum, bsc: RPC.bsc, polygon: RPC.polygon },
      testnet: NETWORK === 'testnet',
      appCode: 'Kript',
      partnerFee: recipient && bps > 0 ? { recipient, bps } : undefined,
    });
  }
  return cow;
}

/** Symbol/decimals for tokens appearing in orders. */
export function tokenMeta(chain: ChainId, address: string): { symbol: string; decimals: number } {
  const a = address.toLowerCase();
  if (a === COW_NATIVE.toLowerCase()) return { symbol: chain === 'bsc' ? 'BNB' : chain === 'polygon' ? 'POL' : 'ETH', decimals: 18 };
  const usdt = limitUsdt(chain);
  if (usdt && usdt.address.toLowerCase() === a) return { symbol: 'USDT', decimals: usdt.decimals };
  const wrapped: Record<string, string> = {
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH', '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'WBNB',
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'WPOL', '0xfff9976782d46cc05630d1f6ebab18b2324d6b14': 'WETH',
    '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK',
  };
  return { symbol: wrapped[a] ?? `${address.slice(0, 6)}…`, decimals: 18 };
}
