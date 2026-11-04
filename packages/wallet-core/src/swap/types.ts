import type { ChainId } from '../chains.js';

export interface SwapToken {
  /** Contract / mint address, or NATIVE for the chain's coin */
  address: string;
  symbol: string;
  decimals: number;
}

export interface SwapRequest {
  chain: ChainId;
  sell: SwapToken;
  buy: SwapToken;
  /** Exact amount of `sell` in base units */
  sellAmount: bigint;
  /** User wallet address on this chain */
  taker: string;
  /** Max slippage, basis points (100 = 1%). Default 50. */
  slippageBps?: number;
}

/** What the confirm screen shows. Everything is in base units. */
export interface SwapQuote {
  request: SwapRequest;
  buyAmount: bigint;
  /** Guaranteed minimum after slippage — the swap reverts below this */
  minBuyAmount: bigint;
  /** Our integrator fee, if any, and the token it is taken in */
  integratorFee?: { amount: bigint; token: string };
  /** Estimated network fee in the native coin (base units) */
  networkFee?: bigint;
  /** e.g. "Uniswap V3 → Curve" */
  route: string;
  /** True if an ERC20 approval transaction must be sent first */
  needsApproval: boolean;
  /** Provider-specific payload; opaque for the UI */
  payload: unknown;
  /** When the quote stops being valid (ms since epoch) */
  expiresAt: number;
}

export interface SwapResult {
  /** Approval tx (EVM, if one was needed) */
  approvalTxid?: string;
  txid: string;
}

export interface SwapProvider {
  readonly name: string;
  supports(chain: ChainId): boolean;
  /** Indicative price while the user types (cheap, no transaction). */
  price(req: SwapRequest): Promise<{ buyAmount: bigint }>;
  /** Firm quote with a transaction; validated before it is returned. */
  quote(req: SwapRequest): Promise<SwapQuote>;
  /** Sign (and approve if needed) and submit. privateKey is wiped by the caller. */
  execute(quote: SwapQuote, privateKey: Uint8Array): Promise<SwapResult>;
}

export class SwapError extends Error {
  constructor(
    message: string,
    readonly code: 'no_liquidity' | 'insufficient_funds' | 'insufficient_fee' | 'expired' | 'unsafe_quote' | 'api' | 'unsupported',
  ) {
    super(message);
  }
}

export const DEFAULT_SLIPPAGE_BPS = 50;
/** Never accept quotes with more slippage than this, whatever the UI asks. */
export const MAX_SLIPPAGE_BPS = 300;

export function checkSlippage(buyAmount: bigint, minBuyAmount: bigint, slippageBps: number): void {
  if (slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS) throw new SwapError('Slippage out of range', 'unsafe_quote');
  if (buyAmount <= 0n || minBuyAmount <= 0n) throw new SwapError('Empty quote', 'no_liquidity');
  // Allow 1 bp rounding headroom on top of the requested slippage.
  const floor = (buyAmount * BigInt(10_000 - slippageBps - 1)) / 10_000n;
  if (minBuyAmount < floor) throw new SwapError('Quote minimum is below the allowed slippage', 'unsafe_quote');
  if (minBuyAmount > buyAmount) throw new SwapError('Inconsistent quote', 'unsafe_quote');
}
