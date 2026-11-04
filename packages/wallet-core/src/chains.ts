/**
 * Supported networks and well-known token contracts.
 *
 * ETH, BSC and Polygon share one EVM key (same address on all three),
 * which is what MetaMask / Trust Wallet do as well.
 */

export type ChainId = 'bitcoin' | 'ethereum' | 'bsc' | 'polygon' | 'tron' | 'solana';

export type KeyFamily = 'bitcoin' | 'evm' | 'tron' | 'solana';

export interface ChainInfo {
  id: ChainId;
  name: string;
  family: KeyFamily;
  /** Native coin symbol and decimals */
  nativeSymbol: string;
  nativeDecimals: number;
  /** Token standard label shown to users, e.g. "ERC20" */
  tokenStandard?: string;
  /** EVM chain id (EIP-155), only for EVM chains */
  evmChainId?: number;
}

export const CHAINS: Record<ChainId, ChainInfo> = {
  bitcoin: { id: 'bitcoin', name: 'Bitcoin', family: 'bitcoin', nativeSymbol: 'BTC', nativeDecimals: 8 },
  ethereum: {
    id: 'ethereum', name: 'Ethereum', family: 'evm', nativeSymbol: 'ETH', nativeDecimals: 18,
    tokenStandard: 'ERC20', evmChainId: 1,
  },
  bsc: {
    id: 'bsc', name: 'BNB Smart Chain', family: 'evm', nativeSymbol: 'BNB', nativeDecimals: 18,
    tokenStandard: 'BEP20', evmChainId: 56,
  },
  polygon: {
    id: 'polygon', name: 'Polygon', family: 'evm', nativeSymbol: 'POL', nativeDecimals: 18,
    tokenStandard: 'ERC20', evmChainId: 137,
  },
  tron: { id: 'tron', name: 'Tron', family: 'tron', nativeSymbol: 'TRX', nativeDecimals: 6, tokenStandard: 'TRC20' },
  solana: { id: 'solana', name: 'Solana', family: 'solana', nativeSymbol: 'SOL', nativeDecimals: 9, tokenStandard: 'SPL' },
};

export interface TokenInfo {
  symbol: string;
  chain: ChainId;
  /** Contract address (EVM/Tron) or mint address (Solana) */
  address: string;
  decimals: number;
}

/**
 * Official USDT deployments. Verify against Tether's published list before
 * every release — a wrong address here means user funds go to the wrong token.
 */
export const USDT: Record<Exclude<ChainId, 'bitcoin'>, TokenInfo> = {
  ethereum: { symbol: 'USDT', chain: 'ethereum', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  bsc: { symbol: 'USDT', chain: 'bsc', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  polygon: { symbol: 'USDT', chain: 'polygon', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
  tron: { symbol: 'USDT', chain: 'tron', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
  solana: { symbol: 'USDT', chain: 'solana', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
};
