/**
 * Solana swaps via Jupiter Swap API V2 (/order + /execute).
 *
 * Jupiter returns a ready transaction (routes are too complex to decode), so
 * instead of trusting it we SIMULATE it on our own RPC and look at the user's
 * balances after execution:
 *   - the user spends no more than the sell amount (+ a small SOL allowance for fees/rent);
 *   - the user receives at least the guaranteed minimum.
 * Anything else — or a failed simulation — and we refuse to sign.
 */
import { Query } from './qs.js';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  checkSlippage,
  DEFAULT_SLIPPAGE_BPS,
  SwapError,
  type SwapProvider,
  type SwapQuote,
  type SwapRequest,
  type SwapResult,
} from './types.js';
import type { ChainId } from '../chains.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
/** Max extra SOL the user may lose to network fees / account rent in one swap */
const SOL_FEE_ALLOWANCE = 10_000_000n; // 0.01 SOL

export interface JupiterOptions {
  connection: Connection;
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Integrator fee via Jupiter referral program (50–255 bps) */
  referral?: { account: string; feeBps: number };
}

interface JupOrder {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  feeBps?: number;
  feeMint?: string;
  router?: string;
  routePlan?: Array<{ swapInfo: { label: string } }>;
  transaction: string | null;
  requestId: string;
  signatureFeePayer?: string | null;
  signatureFeeLamports?: number;
  prioritizationFeeLamports?: number;
  rentFeeLamports?: number;
  errorCode?: number;
  errorMessage?: string;
  error?: string;
}

interface JupPayload {
  tx: string; // base64 unsigned
  requestId: string;
}

export class JupiterProvider implements SwapProvider {
  readonly name = 'Jupiter';
  private base: string;
  private fetcher: typeof fetch;

  constructor(private opts: JupiterOptions) {
    this.base = opts.baseUrl ?? 'https://api.jup.ag/swap/v2';
    this.fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    if (opts.referral && (opts.referral.feeBps < 50 || opts.referral.feeBps > 255)) throw new Error('Jupiter referral fee must be 50–255 bps');
  }

  supports(chain: ChainId) {
    return chain === 'solana';
  }

  private headers(): Record<string, string> {
    return this.opts.apiKey ? { 'x-api-key': this.opts.apiKey } : {};
  }

  private async order(req: SwapRequest, withTaker: boolean): Promise<JupOrder> {
    const p = new Query({
      inputMint: req.sell.address,
      outputMint: req.buy.address,
      amount: req.sellAmount.toString(),
      slippageBps: String(req.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
    });
    if (withTaker) p.set('taker', req.taker);
    if (this.opts.referral) {
      p.set('referralAccount', this.opts.referral.account);
      p.set('referralFee', String(this.opts.referral.feeBps));
    }
    const r = await this.fetcher(`${this.base}/order?${p}`, { headers: this.headers() });
    const body = (await r.json().catch(() => ({}))) as JupOrder;
    if (!r.ok) throw new SwapError(`Jupiter ${r.status}: ${body.error ?? 'error'}`, 'api');
    return body;
  }

  async price(req: SwapRequest) {
    const o = await this.order(req, false);
    if (!o.outAmount || o.outAmount === '0') throw new SwapError('No route for this pair', 'no_liquidity');
    return { buyAmount: BigInt(o.outAmount) };
  }

  async quote(req: SwapRequest): Promise<SwapQuote> {
    if (req.chain !== 'solana') throw new SwapError('Unsupported chain', 'unsupported');
    if (req.sellAmount <= 0n) throw new SwapError('Amount must be positive', 'unsafe_quote');
    const o = await this.order(req, true);
    if (!o.transaction) {
      if (o.errorCode === 1) throw new SwapError('Insufficient balance', 'insufficient_funds');
      if (o.errorCode === 2) throw new SwapError('Not enough SOL for fees', 'insufficient_fee');
      throw new SwapError(o.errorMessage ?? 'Jupiter could not build a transaction', 'no_liquidity');
    }
    const fail = (m: string): never => { throw new SwapError(`Unsafe Jupiter order: ${m}`, 'unsafe_quote'); };
    if (o.inputMint !== req.sell.address || o.outputMint !== req.buy.address) fail('mint mismatch');
    if (BigInt(o.inAmount) !== req.sellAmount) fail('amount mismatch');
    const slippage = req.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    checkSlippage(BigInt(o.outAmount), BigInt(o.otherAmountThreshold), slippage);

    const vtx = VersionedTransaction.deserialize(Buffer.from(o.transaction, 'base64'));
    checkSigners(vtx, req.taker, o.signatureFeePayer ?? null);
    await verifyBySimulation(this.opts.connection, vtx, req, BigInt(o.otherAmountThreshold));

    const labels = (o.routePlan ?? []).map((r) => r.swapInfo.label).filter((s, i, a) => a.indexOf(s) === i);
    const gasless = !!o.signatureFeePayer && o.signatureFeePayer !== req.taker;
    const payload: JupPayload = { tx: o.transaction, requestId: o.requestId };
    return {
      request: req,
      buyAmount: BigInt(o.outAmount),
      minBuyAmount: BigInt(o.otherAmountThreshold),
      integratorFee: o.feeBps && o.feeMint ? { amount: 0n, token: o.feeMint } : undefined,
      networkFee: gasless ? 0n : BigInt((o.signatureFeeLamports ?? 5000) + (o.prioritizationFeeLamports ?? 0) + (o.rentFeeLamports ?? 0)),
      route: labels.join(' → ') || o.router || 'Jupiter',
      needsApproval: false,
      payload,
      expiresAt: Date.now() + 30_000,
    };
  }

  async execute(quote: SwapQuote, privateKey: Uint8Array): Promise<SwapResult> {
    if (Date.now() > quote.expiresAt) throw new SwapError('Quote expired, refresh it', 'expired');
    const p = quote.payload as JupPayload;
    const kp = Keypair.fromSeed(privateKey);
    try {
      if (kp.publicKey.toBase58() !== quote.request.taker) throw new SwapError('Key does not match wallet', 'unsafe_quote');
      const vtx = VersionedTransaction.deserialize(Buffer.from(p.tx, 'base64'));
      vtx.sign([kp]);
      const r = await this.fetcher(`${this.base}/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers() },
        body: JSON.stringify({ signedTransaction: Buffer.from(vtx.serialize()).toString('base64'), requestId: p.requestId }),
      });
      const body = (await r.json().catch(() => ({}))) as { status?: string; signature?: string; error?: string; code?: number };
      if (!r.ok || body.status !== 'Success' || !body.signature) {
        throw new SwapError(`Swap failed: ${body.error ?? body.status ?? r.status}`, 'api');
      }
      return { txid: body.signature };
    } finally {
      kp.secretKey.fill(0);
    }
  }
}

/** The user's key must be a required signer; the fee payer is the user or Jupiter's declared gas wallet. */
export function checkSigners(vtx: VersionedTransaction, taker: string, declaredFeePayer: string | null) {
  const keys = vtx.message.staticAccountKeys.map((k) => k.toBase58());
  const nSigners = vtx.message.header.numRequiredSignatures;
  const signers = keys.slice(0, nSigners);
  if (!signers.includes(taker)) throw new SwapError('Unsafe Jupiter order: wallet is not a signer', 'unsafe_quote');
  const feePayer = keys[0];
  if (feePayer !== taker && feePayer !== declaredFeePayer) {
    throw new SwapError('Unsafe Jupiter order: unexpected fee payer', 'unsafe_quote');
  }
}

/** u64 little-endian `amount` of an SPL token account (offset 64). */
function tokenAmount(data: Buffer): bigint {
  return data.readBigUInt64LE(64);
}

export async function verifyBySimulation(conn: Connection, vtx: VersionedTransaction, req: SwapRequest, minOut: bigint) {
  const taker = new PublicKey(req.taker);
  const watch = (mint: string) => (mint === SOL_MINT ? taker : getAssociatedTokenAddressSync(new PublicKey(mint), taker, true));
  const inAcc = watch(req.sell.address);
  const outAcc = watch(req.buy.address);

  const pre = async (mint: string, acc: PublicKey): Promise<bigint> => {
    if (mint === SOL_MINT) return BigInt(await conn.getBalance(acc));
    const info = await conn.getAccountInfo(acc);
    return info ? tokenAmount(Buffer.from(info.data)) : 0n;
  };
  const [inBefore, outBefore] = await Promise.all([pre(req.sell.address, inAcc), pre(req.buy.address, outAcc)]);

  const sim = await conn.simulateTransaction(vtx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: 'base64', addresses: [inAcc.toBase58(), outAcc.toBase58()] },
  });
  if (sim.value.err) throw new SwapError(`Swap simulation failed: ${JSON.stringify(sim.value.err)}`, 'unsafe_quote');
  const after = sim.value.accounts ?? [];
  const post = (mint: string, i: number): bigint => {
    const a = after[i];
    if (!a) return 0n;
    if (mint === SOL_MINT) return BigInt(a.lamports);
    return tokenAmount(Buffer.from(a.data[0] ?? '', 'base64'));
  };
  const spent = inBefore - post(req.sell.address, 0);
  const got = post(req.buy.address, 1) - outBefore;

  const spendCap = req.sellAmount + (req.sell.address === SOL_MINT ? SOL_FEE_ALLOWANCE : 0n);
  const gotFloor = minOut - (req.buy.address === SOL_MINT ? SOL_FEE_ALLOWANCE : 0n);
  if (spent > spendCap) throw new SwapError('Unsafe Jupiter order: spends more than requested', 'unsafe_quote');
  if (got < gotFloor) throw new SwapError('Unsafe Jupiter order: receives less than the guaranteed minimum', 'unsafe_quote');
}
