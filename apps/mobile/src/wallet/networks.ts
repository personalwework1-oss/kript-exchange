import {
  BitcoinAdapter,
  CHAINS,
  EvmAdapter,
  SolanaAdapter,
  TronAdapter,
  type ChainId,
  type DerivedAccounts,
  type KeyFamily,
  type NetworkAdapter,
} from '@kript/wallet-core';
import { NETWORK, RPC, TESTNET, TRONGRID_KEY } from '../config';

export const CHAIN_ORDER: ChainId[] = ['bitcoin', 'ethereum', 'tron', 'bsc', 'solana', 'polygon'];

const cache = new Map<ChainId, NetworkAdapter>();

export function adapter(chain: ChainId): NetworkAdapter {
  const hit = cache.get(chain);
  if (hit) return hit;
  const test = NETWORK === 'testnet';
  let a: NetworkAdapter;
  switch (chain) {
    case 'bitcoin':
      a = new BitcoinAdapter({ network: test ? 'testnet' : 'mainnet', esploraUrl: RPC.esplora });
      break;
    case 'ethereum':
    case 'bsc':
    case 'polygon':
      a = new EvmAdapter({
        chain,
        rpcUrl: RPC[chain],
        // Alchemy endpoints can list every ERC20 the wallet holds
        alchemyDiscovery: RPC[chain].includes('alchemy.com'),
        ...(test
          ? { chainIdOverride: TESTNET[chain].chainId, explorerTxBase: TESTNET[chain].explorer, usdtAddress: TESTNET[chain].usdt ?? null }
          : {}),
      });
      break;
    case 'tron':
      a = new TronAdapter({ fullHost: RPC.tron, apiKey: TRONGRID_KEY, usdtAddress: test ? TESTNET.tron.usdt : undefined });
      break;
    case 'solana':
      a = new SolanaAdapter({ rpcUrl: RPC.solana, usdtMint: test ? TESTNET.solana.usdtMint : undefined });
      break;
  }
  cache.set(chain, a);
  return a;
}

/** On testnets USDT is only available where a test token is configured. */
export function usdtSupported(chain: ChainId): boolean {
  if (chain === 'bitcoin') return false;
  if (NETWORK === 'mainnet') return true;
  if (chain === 'tron') return !!TESTNET.tron.usdt;
  if (chain === 'solana') return !!TESTNET.solana.usdtMint;
  return !!TESTNET[chain].usdt;
}

export function familyOf(chain: ChainId): KeyFamily {
  return CHAINS[chain].family;
}

export function addressOf(accounts: DerivedAccounts, chain: ChainId): string {
  return accounts[familyOf(chain)].address;
}

export function networkLabel(chain: ChainId): string {
  const c = CHAINS[chain];
  const base = c.tokenStandard && chain !== 'solana' ? `${c.name} (${c.tokenStandard})` : c.name;
  return NETWORK === 'testnet' ? `${base} · testnet` : base;
}
