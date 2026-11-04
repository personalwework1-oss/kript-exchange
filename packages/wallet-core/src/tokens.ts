/**
 * Curated, verified tokens per network.
 *
 * Sources:
 *  - Ethereum / BNB Chain / Polygon / Solana: Uniswap default token list (@uniswap/default-token-list).
 *    Every entry is asserted against that list in test/tokens.test.ts.
 *  - Tron: project/issuer sources (SUN.io announcement for USDD 2.0, TRONSCAN for JST, Bitquery for BTT/SUN).
 *  - In the app every token is also checked ON-CHAIN (decimals, and symbol where the chain stores it)
 *    before being shown as verified.
 *
 * Tokens not in this list are "unverified": hidden by default, never offered for trading.
 */
import { USDT, type ChainId } from './chains.js';

export interface TokenInfo2 {
  chain: ChainId;
  /** Contract (EVM/Tron) or mint (Solana) address */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** CoinGecko id for prices */
  cgId?: string;
  /** Glyph + color for the icon */
  glyph?: string;
  color?: string;
}

const t = (chain: ChainId, symbol: string, name: string, address: string, decimals: number, cgId?: string, color?: string): TokenInfo2 =>
  ({ chain, symbol, name, address, decimals, cgId, color, glyph: symbol[0] });

export const TOKENS: TokenInfo2[] = [
  // ── Ethereum (ERC20)
  t('ethereum', 'USDT', 'Tether', USDT.ethereum.address, 6, 'tether', '#26A17B'),
  t('ethereum', 'USDC', 'USD Coin', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'usd-coin', '#2775CA'),
  t('ethereum', 'DAI', 'Dai', '0x6B175474E89094C44Da98b954EedeAC495271d0F', 18, 'dai', '#F5AC37'),
  t('ethereum', 'WBTC', 'Wrapped Bitcoin', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 8, 'wrapped-bitcoin', '#F09242'),
  t('ethereum', 'LINK', 'Chainlink', '0x514910771AF9Ca656af840dff83E8264EcF986CA', 18, 'chainlink', '#2A5ADA'),
  t('ethereum', 'UNI', 'Uniswap', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', 18, 'uniswap', '#FF007A'),
  t('ethereum', 'AAVE', 'Aave', '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', 18, 'aave', '#B6509E'),
  t('ethereum', 'PEPE', 'Pepe', '0x6982508145454Ce325dDbE47a25d4ec3d2311933', 18, 'pepe', '#3D9B3D'),
  t('ethereum', 'SHIB', 'Shiba Inu', '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', 18, 'shiba-inu', '#E42D06'),
  t('ethereum', 'LDO', 'Lido DAO', '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', 18, 'lido-dao', '#00A3FF'),
  t('ethereum', 'ONDO', 'Ondo', '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3', 18, 'ondo-finance', '#1B2A4A'),
  t('ethereum', 'ENA', 'Ethena', '0x57e114B691Db790C35207b2e685D4A43181e6061', 18, 'ethena', '#111111'),
  // ── BNB Chain (BEP20)
  t('bsc', 'USDT', 'Tether', USDT.bsc.address, 18, 'tether', '#26A17B'),
  t('bsc', 'USDC', 'USD Coin', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18, 'usd-coin', '#2775CA'),
  t('bsc', 'DAI', 'Dai', '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', 18, 'dai', '#F5AC37'),
  t('bsc', 'LINK', 'Chainlink', '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD', 18, 'chainlink', '#2A5ADA'),
  t('bsc', 'UNI', 'Uniswap', '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1', 18, 'uniswap', '#FF007A'),
  t('bsc', 'AAVE', 'Aave', '0xfb6115445Bff7b52FeB98650C87f44907E58f802', 18, 'aave', '#B6509E'),
  t('bsc', 'FLOKI', 'Floki', '0xfb5B838b6cfEEdC2873aB27866079AC55363D37E', 9, 'floki', '#F2A900'),
  // ── Polygon
  t('polygon', 'USDT', 'Tether', USDT.polygon.address, 6, 'tether', '#26A17B'),
  t('polygon', 'USDC', 'USD Coin', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6, 'usd-coin', '#2775CA'),
  t('polygon', 'DAI', 'Dai', '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', 18, 'dai', '#F5AC37'),
  t('polygon', 'WETH', 'Wrapped Ether', '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 18, 'weth', '#627EEA'),
  t('polygon', 'WBTC', 'Wrapped Bitcoin', '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', 8, 'wrapped-bitcoin', '#F09242'),
  t('polygon', 'LINK', 'Chainlink', '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', 18, 'chainlink', '#2A5ADA'),
  t('polygon', 'AAVE', 'Aave', '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', 18, 'aave', '#B6509E'),
  // ── Solana (SPL)
  t('solana', 'USDT', 'Tether', USDT.solana.address, 6, 'tether', '#26A17B'),
  t('solana', 'USDC', 'USD Coin', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6, 'usd-coin', '#2775CA'),
  t('solana', 'JUP', 'Jupiter', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 6, 'jupiter-exchange-solana', '#2CE6B4'),
  t('solana', 'BONK', 'Bonk', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 5, 'bonk', '#F8A300'),
  t('solana', 'WIF', 'dogwifhat', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 6, 'dogwifcoin', '#B98B5B'),
  t('solana', 'RAY', 'Raydium', '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', 6, 'raydium', '#6E44FF'),
  t('solana', 'PYTH', 'Pyth Network', 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', 6, 'pyth-network', '#7B5CD6'),
  t('solana', 'JTO', 'Jito', 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', 9, 'jito-governance-token', '#2E9E6B'),
  t('solana', 'TRUMP', 'Official Trump', '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', 6, 'official-trump', '#C9A227'),
  t('solana', 'POPCAT', 'Popcat', '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', 9, 'popcat', '#E8A0B4'),
  t('solana', 'ORCA', 'Orca', 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', 6, 'orca', '#FFD15C'),
  // ── Tron (TRC20)
  t('tron', 'USDT', 'Tether', USDT.tron.address, 6, 'tether', '#26A17B'),
  t('tron', 'USDD', 'USDD', 'TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz', 18, 'usdd', '#1BB37A'),
  t('tron', 'BTT', 'BitTorrent', 'TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4', 18, 'bittorrent', '#7D2E8E'),
  t('tron', 'JST', 'JUST', 'TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9', 18, 'just', '#B5212F'),
  t('tron', 'SUN', 'SUN', 'TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S', 18, 'sun-token', '#F6A01A'),
];

const norm = (chain: ChainId, a: string) => (chain === 'solana' || chain === 'tron' ? a : a.toLowerCase());

export function tokensOn(chain: ChainId): TokenInfo2[] {
  return TOKENS.filter((x) => x.chain === chain);
}

export function findToken(chain: ChainId, address: string): TokenInfo2 | undefined {
  const a = norm(chain, address);
  return TOKENS.find((x) => x.chain === chain && norm(chain, x.address) === a);
}

/** Symbols used by verified tokens — an unverified token using one of these is a likely impostor. */
export function isImpostorSymbol(chain: ChainId, symbol: string, address: string): boolean {
  if (findToken(chain, address)) return false;
  const s = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return TOKENS.some((x) => x.symbol.toUpperCase() === s);
}
