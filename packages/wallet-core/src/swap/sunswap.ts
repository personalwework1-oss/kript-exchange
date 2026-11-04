/**
 * Tron swaps: USDT (TRC20) <-> TRX via SunSwap V2 (a Uniswap V2 fork).
 *
 * Safety model:
 *  - The router is verified ON-CHAIN before first use: its factory() must be the
 *    official SunSwap V2 factory and its wrapped-TRX getter must return WTRX.
 *    Function names are read from the router's on-chain ABI (some forks rename
 *    ETH -> TRX), so we never guess them.
 *  - We ABI-encode every call ourselves and pass it as rawParameter; the node only
 *    wraps it into a transaction. Before signing we check the node's transaction
 *    byte-for-byte: contract, selector + params, call value, sender, hash.
 *  - Approval goes only to the router, only for the swap amount (reset to 0 first if
 *    a non-zero allowance exists — Tron USDT has the same rule as Ethereum USDT).
 */
import { TronWeb, utils as tronUtils } from 'tronweb';
import { encodeAbiParameters, decodeAbiParameters, toFunctionSelector, type Hex } from 'viem';
import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { tronAddressFromPublicKey } from '../derive.js';
import { USDT, type ChainId } from '../chains.js';
import {
  checkSlippage,
  DEFAULT_SLIPPAGE_BPS,
  SwapError,
  type SwapProvider,
  type SwapQuote,
  type SwapRequest,
  type SwapResult,
} from './types.js';

/** Marker for native TRX in SwapToken.address */
export const TRX_NATIVE = 'TRX';
export const WTRX = 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR';
export const SUNSWAP_V2_FACTORY = 'TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY';
/** Default router; verified on-chain against the factory and WTRX before use. */
export const SUNSWAP_V2_ROUTER = 'TNJVzGqKBWkJxJB5XYSqGAwUTV15U24pPq';

const DEADLINE_SEC = 10 * 60;
/** Swaps cost ~65–130k energy; without staked energy that is burned TRX. Cap: 200 TRX. */
const FEE_LIMIT_SUN = 200_000_000;
/** Fallback network-fee estimate when simulation is impossible (before approval) */
const EST_SWAP_FEE_SUN = 40_000_000n;

export interface SunSwapOptions {
  fullHost?: string;
  apiKey?: string;
  tronWeb?: TronWeb;
  router?: string;
  factory?: string;
  usdtAddress?: string;
}

interface RouterInfo {
  exactNativeForTokens: string; // e.g. swapExactETHForTokens or swapExactTRXForTokens
  exactTokensForNative: string; // e.g. swapExactTokensForETH or swapExactTokensForTRX
}

type Kind = 'native->token' | 'token->native' | 'token->token';

type TronTx = {
  txID: string;
  raw_data: { contract: Array<{ type: string; parameter: { value: Record<string, unknown> } }>; [k: string]: unknown };
  raw_data_hex: string;
  signature?: string[];
};

interface SunPayload {
  kind: Kind;
  path: string[];
  deadline: number;
  currentAllowance: bigint;
}

const evmHex = (tron: string): Hex => `0x${TronWeb.address.toHex(tron).slice(2)}` as Hex;
const hex41 = (tron: string) => TronWeb.address.toHex(tron).toLowerCase();

export class SunSwapProvider implements SwapProvider {
  readonly name = 'SunSwap';
  private tw: TronWeb;
  private router: string;
  private factory: string;
  private usdt: string;
  private info: Promise<RouterInfo> | null = null;

  constructor(opts: SunSwapOptions) {
    this.tw = opts.tronWeb ?? new TronWeb({ fullHost: opts.fullHost!, headers: opts.apiKey ? { 'TRON-PRO-API-KEY': opts.apiKey } : undefined });
    this.router = opts.router ?? SUNSWAP_V2_ROUTER;
    this.factory = opts.factory ?? SUNSWAP_V2_FACTORY;
    this.usdt = opts.usdtAddress ?? USDT.tron.address;
  }

  supports(chain: ChainId) {
    return chain === 'tron';
  }

  /** Read-only contract call; returns raw hex result. */
  private async call(contract: string, signature: string, params: Hex = '0x', from?: string): Promise<{ result: Hex; energy: number }> {
    const r = await this.tw.transactionBuilder.triggerConstantContract(
      contract, signature, { rawParameter: params.slice(2) } as never, [], from ?? this.router,
    );
    const out = r.constant_result?.[0];
    if (!r.result?.result || out === undefined) throw new SwapError(`Tron call ${signature} failed`, 'api');
    return { result: `0x${out}` as Hex, energy: Number(r.energy_used ?? 0) };
  }

  /** Verify the router on-chain once, and learn its function names. */
  routerInfo(): Promise<RouterInfo> {
    if (!this.info) {
      this.info = (async () => {
        const c = (await (this.tw.trx as unknown as { getContract(a: string): Promise<{ abi?: { entrys?: Array<{ name?: string; type?: string }> } }> }).getContract(this.router));
        const names = new Set((c.abi?.entrys ?? []).filter((e) => (e.type ?? 'Function') === 'Function').map((e) => e.name));
        const pick = (a: string, b: string) => (names.has(a) ? a : names.has(b) ? b : null);
        const wrappedGetter = pick('WETH', 'WTRX');
        const n2t = pick('swapExactETHForTokens', 'swapExactTRXForTokens');
        const t2n = pick('swapExactTokensForETH', 'swapExactTokensForTRX');
        if (!wrappedGetter || !n2t || !t2n || !names.has('factory') || !names.has('getAmountsOut') || !names.has('swapExactTokensForTokens')) {
          throw new SwapError('Router ABI does not look like SunSwap V2', 'unsafe_quote');
        }
        const [fac, wrapped] = await Promise.all([this.call(this.router, 'factory()'), this.call(this.router, `${wrappedGetter}()`)]);
        const asTron = (h: Hex) => TronWeb.address.fromHex('41' + h.slice(-40));
        if (asTron(fac.result) !== this.factory) throw new SwapError('Router is not bound to the official SunSwap V2 factory', 'unsafe_quote');
        if (asTron(wrapped.result) !== WTRX) throw new SwapError('Router wrapped-TRX mismatch', 'unsafe_quote');
        return { exactNativeForTokens: n2t, exactTokensForNative: t2n };
      })();
      this.info.catch(() => { this.info = null; });
    }
    return this.info;
  }

  private direction(req: SwapRequest): Kind {
    const isTok = (a: string) => a !== TRX_NATIVE && TronWeb.isAddress(a);
    if (req.sell.address === req.buy.address) throw new SwapError('Same token', 'unsupported');
    if (req.sell.address === TRX_NATIVE && isTok(req.buy.address)) return 'native->token';
    if (isTok(req.sell.address) && req.buy.address === TRX_NATIVE) return 'token->native';
    if (isTok(req.sell.address) && isTok(req.buy.address)) return 'token->token';
    throw new SwapError('Unsupported pair', 'unsupported');
  }

  /** Candidate routes: direct pair, and through WTRX for token->token. */
  private candidates(kind: Kind, req: SwapRequest): string[][] {
    if (kind === 'native->token') return [[WTRX, req.buy.address]];
    if (kind === 'token->native') return [[req.sell.address, WTRX]];
    return [[req.sell.address, req.buy.address], [req.sell.address, WTRX, req.buy.address]];
  }

  private async amountsOut(amount: bigint, path: string[]): Promise<bigint> {
    const params = encodeAbiParameters([{ type: 'uint256' }, { type: 'address[]' }], [amount, path.map(evmHex)]);
    const { result } = await this.call(this.router, 'getAmountsOut(uint256,address[])', params);
    const [amounts] = decodeAbiParameters([{ type: 'uint256[]' }], result);
    return amounts.at(-1) ?? 0n;
  }

  /** Best route by output amount (a missing pair simply drops out). */
  private async best(req: SwapRequest): Promise<{ kind: Kind; path: string[]; out: bigint }> {
    const kind = this.direction(req);
    await this.routerInfo();
    const results = await Promise.all(this.candidates(kind, req).map(async (path) => ({
      path, out: await this.amountsOut(req.sellAmount, path).catch(() => 0n),
    })));
    const top = results.sort((a, b) => (b.out > a.out ? 1 : b.out < a.out ? -1 : 0))[0]!;
    if (top.out <= 0n) throw new SwapError('No liquidity', 'no_liquidity');
    return { kind, path: top.path, out: top.out };
  }

  async price(req: SwapRequest) {
    return { buyAmount: (await this.best(req)).out };
  }

  async quote(req: SwapRequest): Promise<SwapQuote> {
    if (req.sellAmount <= 0n) throw new SwapError('Amount must be positive', 'unsafe_quote');
    const slippage = req.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    const [{ kind, path, out: buyAmount }, balanceTrx] = await Promise.all([this.best(req), this.tw.trx.getBalance(req.taker)]);
    const minBuyAmount = (buyAmount * BigInt(10_000 - slippage)) / 10_000n;
    checkSlippage(buyAmount, minBuyAmount, slippage);

    let currentAllowance = 0n;
    let needsApproval = false;
    if (kind !== 'native->token') {
      const p = encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [evmHex(req.taker), evmHex(this.router)]);
      const bal = encodeAbiParameters([{ type: 'address' }], [evmHex(req.taker)]);
      const [a, b] = await Promise.all([this.call(req.sell.address, 'allowance(address,address)', p, req.taker), this.call(req.sell.address, 'balanceOf(address)', bal, req.taker)]);
      currentAllowance = BigInt(a.result);
      if (BigInt(b.result) < req.sellAmount) throw new SwapError('Insufficient token balance', 'insufficient_funds');
      needsApproval = currentAllowance < req.sellAmount;
    } else if (BigInt(balanceTrx) < req.sellAmount) {
      throw new SwapError('Insufficient TRX', 'insufficient_funds');
    }
    const networkFee = EST_SWAP_FEE_SUN * (needsApproval ? (currentAllowance > 0n ? 3n : 2n) : 1n);
    const needTrx = networkFee + (kind === 'native->token' ? req.sellAmount : 0n);
    if (BigInt(balanceTrx) < needTrx) throw new SwapError('Not enough TRX for fees', 'insufficient_fee');

    const payload: SunPayload = { kind, path, deadline: Math.floor(Date.now() / 1000) + DEADLINE_SEC, currentAllowance };
    return {
      request: req, buyAmount, minBuyAmount, networkFee, route: path.length > 2 ? 'SunSwap V2 (через TRX)' : 'SunSwap V2', needsApproval, payload,
      expiresAt: Date.now() + 30_000,
    };
  }

  /** Expected ABI-encoded params (no selector) for the swap call. Exported for tests. */
  swapParams(q: SwapQuote): Hex {
    const p = q.payload as SunPayload;
    const path = p.path.map(evmHex);
    const to = evmHex(q.request.taker);
    if (p.path[0] !== (p.kind === 'native->token' ? WTRX : q.request.sell.address)) throw new SwapError('Route does not start with the sell token', 'unsafe_quote');
    if (p.path.at(-1) !== (p.kind === 'token->native' ? WTRX : q.request.buy.address)) throw new SwapError('Route does not end with the buy token', 'unsafe_quote');
    return p.kind === 'native->token'
      ? encodeAbiParameters([{ type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }], [q.minBuyAmount, path, to, BigInt(p.deadline)])
      : encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }], [q.request.sellAmount, q.minBuyAmount, path, to, BigInt(p.deadline)]);
  }

  private async build(owner: string, contract: string, signature: string, params: Hex, callValue: bigint): Promise<TronTx> {
    const built = await this.tw.transactionBuilder.triggerSmartContract(
      contract, signature, { feeLimit: FEE_LIMIT_SUN, callValue: Number(callValue), rawParameter: params.slice(2) }, [], owner,
    );
    if (!built.result?.result) throw new SwapError('Node refused to build the transaction', 'api');
    const tx = built.transaction as unknown as TronTx;
    verifyTronCall(tx, { owner, contract, data: toFunctionSelector(signature).slice(2) + params.slice(2), callValue });
    return tx;
  }

  private async signSend(tx: TronTx, privateKey: Uint8Array): Promise<string> {
    const signed = (await this.tw.trx.sign(tx as never, hex.encode(privateKey))) as unknown as TronTx;
    const res = await this.tw.trx.sendRawTransaction(signed as never);
    if (!res.result) throw new SwapError(`Broadcast failed: ${JSON.stringify(res)}`, 'api');
    return signed.txID;
  }

  private async waitConfirmed(txid: string, timeoutMs = 60_000) {
    const trx = this.tw.trx as unknown as { getTransactionInfo(id: string): Promise<{ id?: string; receipt?: { result?: string } }> };
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const info = await trx.getTransactionInfo(txid).catch(() => ({} as { id?: string; receipt?: { result?: string } }));
      if (info.id) {
        if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new SwapError(`Transaction failed: ${info.receipt.result}`, 'api');
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new SwapError('Transaction not confirmed in time', 'api');
  }

  async execute(quote: SwapQuote, privateKey: Uint8Array): Promise<SwapResult> {
    if (Date.now() > quote.expiresAt) throw new SwapError('Quote expired, refresh it', 'expired');
    const owner = quote.request.taker;
    if (tronAddressFromPublicKey(secp256k1.getPublicKey(privateKey, false)) !== owner) throw new SwapError('Key does not match wallet', 'unsafe_quote');
    const info = await this.routerInfo();
    const p = quote.payload as SunPayload;

    let approvalTxid: string | undefined;
    if (quote.needsApproval) {
      const approve = async (amount: bigint) => {
        const params = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [evmHex(this.router), amount]);
        const id = await this.signSend(await this.build(owner, quote.request.sell.address, 'approve(address,uint256)', params, 0n), privateKey);
        await this.waitConfirmed(id);
        return id;
      };
      if (p.currentAllowance > 0n) await approve(0n);
      approvalTxid = await approve(quote.request.sellAmount);
    }

    const sig = p.kind === 'native->token'
      ? `${info.exactNativeForTokens}(uint256,address[],address,uint256)`
      : p.kind === 'token->native'
        ? `${info.exactTokensForNative}(uint256,uint256,address[],address,uint256)`
        : 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)';
    const callValue = p.kind === 'native->token' ? quote.request.sellAmount : 0n;
    const txid = await this.signSend(await this.build(owner, this.router, sig, this.swapParams(quote), callValue), privateKey);
    return { approvalTxid, txid };
  }
}

/** Byte-level check of a node-built TriggerSmartContract transaction. Exported for tests. */
export function verifyTronCall(tx: TronTx, exp: { owner: string; contract: string; data: string; callValue: bigint }) {
  const fail = (m: string): never => { throw new SwapError(`Unsafe Tron transaction: ${m}`, 'unsafe_quote'); };
  if (!tronUtils.transaction.txCheck(tx)) fail('raw_data_hex does not match raw_data');
  if (hex.encode(sha256(hex.decode(tx.raw_data_hex))) !== tx.txID.toLowerCase()) fail('txID mismatch');
  if (tx.raw_data.contract.length !== 1) fail('expected one contract');
  const c = tx.raw_data.contract[0]!;
  if (c.type !== 'TriggerSmartContract') fail('not a contract call');
  const v = c.parameter.value as Record<string, string | number | undefined>;
  if (String(v.owner_address).toLowerCase() !== hex41(exp.owner)) fail('wrong sender');
  if (String(v.contract_address).toLowerCase() !== hex41(exp.contract)) fail('wrong contract');
  if (String(v.data).toLowerCase() !== exp.data.toLowerCase()) fail('call data differs from what we encoded');
  if (BigInt(v.call_value ?? 0) !== exp.callValue) fail('wrong TRX value');
}
