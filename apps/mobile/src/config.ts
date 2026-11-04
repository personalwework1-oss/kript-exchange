/**
 * Network endpoints. Put your keys in apps/mobile/.env (see .env.example):
 *   EXPO_PUBLIC_ALCHEMY_KEY=...
 *   EXPO_PUBLIC_HELIUS_KEY=...
 *   EXPO_PUBLIC_TRONGRID_KEY=...
 *   EXPO_PUBLIC_NETWORK=testnet   (or mainnet)
 * NOTE: EXPO_PUBLIC_* values end up inside the app bundle. For production,
 * route RPC calls through our backend so provider keys are not shipped.
 */
const env = process.env;
export const NETWORK: 'mainnet' | 'testnet' = env.EXPO_PUBLIC_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

const alchemy = env.EXPO_PUBLIC_ALCHEMY_KEY ?? '';
const helius = env.EXPO_PUBLIC_HELIUS_KEY ?? '';

export const RPC = NETWORK === 'mainnet'
  ? {
      ethereum: alchemy ? `https://eth-mainnet.g.alchemy.com/v2/${alchemy}` : 'https://ethereum-rpc.publicnode.com',
      bsc: 'https://bsc-rpc.publicnode.com',
      polygon: alchemy ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemy}` : 'https://polygon-bor-rpc.publicnode.com',
      tron: 'https://api.trongrid.io',
      solana: helius ? `https://mainnet.helius-rpc.com/?api-key=${helius}` : 'https://api.mainnet-beta.solana.com',
      esplora: 'https://mempool.space/api',
    }
  : {
      ethereum: alchemy ? `https://eth-sepolia.g.alchemy.com/v2/${alchemy}` : 'https://ethereum-sepolia-rpc.publicnode.com',
      bsc: 'https://bsc-testnet-rpc.publicnode.com',
      polygon: alchemy ? `https://polygon-amoy.g.alchemy.com/v2/${alchemy}` : 'https://polygon-amoy-bor-rpc.publicnode.com',
      tron: 'https://nile.trongrid.io',
      solana: helius ? `https://devnet.helius-rpc.com/?api-key=${helius}` : 'https://api.devnet.solana.com',
      esplora: 'https://mempool.space/testnet4/api',
    };

export const TRONGRID_KEY = env.EXPO_PUBLIC_TRONGRID_KEY;

/** Testnet chain ids and test-token addresses (fill in the tokens you use for testing). */
export const TESTNET = {
  ethereum: { chainId: 11155111, explorer: 'https://sepolia.etherscan.io/tx/', usdt: env.EXPO_PUBLIC_SEPOLIA_USDT },
  bsc: { chainId: 97, explorer: 'https://testnet.bscscan.com/tx/', usdt: env.EXPO_PUBLIC_BSC_TESTNET_USDT },
  polygon: { chainId: 80002, explorer: 'https://amoy.polygonscan.com/tx/', usdt: env.EXPO_PUBLIC_AMOY_USDT },
  tron: { usdt: env.EXPO_PUBLIC_NILE_USDT },
  solana: { usdtMint: env.EXPO_PUBLIC_DEVNET_USDT_MINT },
};

/** Auto-lock after the app spends this long in background */
export const AUTO_LOCK_MS = 2 * 60 * 1000;

/** scrypt cost on phones (~32 MiB). Desktop default in wallet-core is 2^16. */
export const MOBILE_SCRYPT = { N: 2 ** 15, r: 8, p: 1 };
