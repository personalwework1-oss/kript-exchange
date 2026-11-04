import type { ChainId } from '../chains.js';

export type Asset = 'native' | 'usdt' | 'token';

export interface TokenRef {
  address: string;
  decimals: number;
  symbol: string;
}

export interface TokenMeta {
  decimals: number;
  symbol?: string;
  name?: string;
}

export interface Balances {
  chain: ChainId;
  address: string;
  /** Smallest units (sat, wei, sun, lamports) */
  native: bigint;
  /** USDT in token base units (undefined on Bitcoin) */
  usdt?: bigint;
}

export interface DiscoveredToken {
  address: string;
  amount: bigint;
}

export interface TransferRequest {
  chain: ChainId;
  asset: Asset;
  from: string;
  to: string;
  /** Amount in base units */
  amount: bigint;
  /** Required when asset === 'token' */
  token?: TokenRef;
}

export interface FeeEstimate {
  /** Fee in the chain's native coin, base units */
  amount: bigint;
  symbol: string;
  /** Human-readable note shown on the confirm screen */
  note?: string;
}

/**
 * A transfer ready to be signed. `payload` is chain-specific and opaque to the UI.
 * The UI shows `request` + `fee` to the user; nothing else is needed to confirm.
 */
export interface PreparedTransfer {
  request: TransferRequest;
  fee: FeeEstimate;
  payload: unknown;
}

export interface SignedTransfer {
  chain: ChainId;
  /** Hex (EVM, BTC), JSON (Tron) or base64 (Solana) */
  raw: string;
  /** Transaction id / hash, known before broadcast */
  txid: string;
}

export interface NetworkAdapter {
  readonly chain: ChainId;
  validateAddress(address: string): boolean;
  getBalances(address: string): Promise<Balances>;
  /** Balances of the given token contracts/mints (base units); missing = 0 */
  getTokenBalances(address: string, tokens: string[]): Promise<Record<string, bigint>>;
  /** All tokens the address holds (if the network/provider can list them) */
  discoverTokens?(address: string): Promise<DiscoveredToken[]>;
  /** On-chain decimals (and symbol/name where the chain stores them) */
  tokenMetadata(token: string): Promise<TokenMeta>;
  prepareTransfer(req: TransferRequest): Promise<PreparedTransfer>;
  /** privateKey is wiped by the caller after this resolves */
  signTransfer(prepared: PreparedTransfer, privateKey: Uint8Array): Promise<SignedTransfer>;
  broadcast(signed: SignedTransfer): Promise<string>;
  explorerTxUrl(txid: string): string;
}

export class TransferError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_address'
      | 'invalid_amount'
      | 'insufficient_funds'
      | 'insufficient_fee'
      | 'self_transfer'
      | 'unsupported'
      | 'verification_failed',
  ) {
    super(message);
  }
}

export function assertPositive(amount: bigint) {
  if (typeof amount !== 'bigint' || amount <= 0n) throw new TransferError('Amount must be positive', 'invalid_amount');
}

/** Token contract for a transfer: USDT constant for asset 'usdt', the given token for 'token'. */
export function tokenOf(req: TransferRequest, usdt: TokenRef | null): TokenRef {
  if (req.asset === 'usdt') {
    if (!usdt) throw new TransferError('USDT is not available on this network', 'unsupported');
    return usdt;
  }
  if (req.asset === 'token') {
    if (!req.token) throw new TransferError('Token not specified', 'unsupported');
    return req.token;
  }
  throw new TransferError('Not a token transfer', 'unsupported');
}
