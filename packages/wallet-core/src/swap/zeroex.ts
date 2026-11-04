/**
 * EVM swaps via 0x Swap API v2 (AllowanceHolder flow): Ethereum, BSC, Polygon.
 *
 * Safety model — everything returned by the API is checked before signing:
 *  - tokens, chain and sell amount echo what we asked for;
 *  - minBuyAmount respects the slippage we allow;
 *  - the transaction calls AllowanceHolder.exec(...) with exactly our sell token and amount;
 *  - approval goes ONLY to that same contract and ONLY for the exact amount (never "unlimited");
 *  - native value is sent only when selling the native coin, and equals the sell amount.
 */
import { Query } from './qs.js';
import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  keccak256,
  toHex,
  type Hex,
  type PublicClient,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { ChainId } from '../chains.js';
import {
  checkSlippage,
  DEFAULT_SLIPPAGE_BPS,
  SwapError,
  type SwapProvider,
  type SwapQuote,
  type SwapRequest,
  type SwapResult,
} from './types.js';

export const EVM_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

type EvmChain = 'ethereum' | 'bsc' | 'polygon';
const CHAIN_IDS: Record<EvmChain, number> = { ethereum: 1, bsc: 56, polygon: 137 };

const allowanceHolderAbi = [
  {
    type: 'function',
    name: 'exec',
    stateMutability: 'payable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'result', type: 'bytes' }],
  },
] as const;

export interface ZeroExOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** RPC per chain: URL or a viem transport */
  rpc: Partial<Record<EvmChain, string | Transport>>;
  /** Integrator fee: paid by the user to `recipient` on every swap */
  fee?: { recipient: string; bps: number };
}

interface ZxQuote {
  liquidityAvailable: boolean;
  buyAmount: string;
  minBuyAmount: string;
  sellAmount: string;
  buyToken: string;
  sellToken: string;
  transaction?: { to: string; data: string; gas: string | null; gasPrice: string; value: string };
  issues?: {
    allowance: { actual: string; spender: string } | null;
    balance: { token: string; actual: string; expected: string } | null;
  };
  fees?: { integratorFee: { amount: string; token: string } | null };
  route?: { fills?: Array<{ source: string; proportionBps: string }> };
  totalNetworkFee?: string | null;
}

interface ZxPayload {
  chainId: number;
  tx: { to: Hex; data: Hex; value: bigint; gas: bigint; gasPrice: bigint };
  spender: Hex | null;
  /** Allowance before the swap. USDT-style tokens refuse to change a non-zero allowance, so we reset to 0 first. */
  currentAllowance: bigint;
}

const isEvm = (c: ChainId): c is EvmChain => c === 'ethereum' || c === 'bsc' || c === 'polygon';
const lc = (s: string) => s.toLowerCase();

export class ZeroExProvider implements SwapProvider {
  readonly name = '0x';
  private base: string;
  private fetcher: typeof fetch;
  private clients = new Map<EvmChain, PublicClient>();

  constructor(private opts: ZeroExOptions) {
    this.base = opts.baseUrl ?? 'https://api.0x.org';
    this.fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    if (opts.fee) {
      if (!isAddress(opts.fee.recipient)) throw new Error('Bad fee recipient');
      if (opts.fee.bps < 0 || opts.fee.bps > 100) throw new Error('Fee must be 0–100 bps');
    }
  }

  supports(chain: ChainId): boolean {
    return isEvm(chain) && !!this.opts.rpc[chain];
  }

  private client(chain: EvmChain): PublicClient {
    let c = this.clients.get(chain);
    if (!c) {
      const r = this.opts.rpc[chain];
      if (!r) throw new SwapError(`No RPC for ${chain}`, 'unsupported');
      c = createPublicClient({ transport: typeof r === 'string' ? http(r) : r }) as PublicClient;
      this.clients.set(chain, c);
    }
    return c;
  }

  private params(req: SwapRequest, withTaker: boolean): Query {
    if (!isEvm(req.chain)) throw new SwapError('Unsupported chain', 'unsupported');
    const p = new Query({
      chainId: String(CHAIN_IDS[req.chain]),
      sellToken: req.sell.address,
      buyToken: req.buy.address,
      sellAmount: req.sellAmount.toString(),
      slippageBps: String(req.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
    });
    if (withTaker) p.set('taker', getAddress(req.taker));
    if (this.opts.fee && this.opts.fee.bps > 0) {
      p.set('swapFeeRecipient', this.opts.fee.recipient);
      p.set('swapFeeBps', String(this.opts.fee.bps));
      p.set('swapFeeToken', req.sell.address === EVM_NATIVE ? req.buy.address : req.sell.address);
    }
    return p;
  }

  private async get(path: string, p: Query): Promise<ZxQuote> {
    const r = await this.fetcher(`${this.base}${path}?${p}`, {
      headers: { '0x-api-key': this.opts.apiKey, '0x-version': 'v2' },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new SwapError(`0x API ${r.status}: ${(body as { message?: string }).message ?? 'error'}`, 'api');
    return body as ZxQuote;
  }

  async price(req: SwapRequest) {
    const q = await this.get('/swap/allowance-holder/price', this.params(req, false));
    if (!q.liquidityAvailable) throw new SwapError('No liquidity for this pair', 'no_liquidity');
    return { buyAmount: BigInt(q.buyAmount) };
  }

  async quote(req: SwapRequest): Promise<SwapQuote> {
    if (!isEvm(req.chain)) throw new SwapError('Unsupported chain', 'unsupported');
    if (req.sellAmount <= 0n) throw new SwapError('Amount must be positive', 'unsafe_quote');
    if (lc(req.sell.address) === lc(req.buy.address)) throw new SwapError('Same token', 'unsafe_quote');
    const slippage = req.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    const q = await this.get('/swap/allowance-holder/quote', this.params(req, true));
    const payload = validateZeroExQuote(q, req, CHAIN_IDS[req.chain], slippage);

    if (q.issues?.balance) throw new SwapError('Insufficient balance', 'insufficient_funds');
    const needsApproval = !!payload.spender && BigInt(q.issues?.allowance?.actual ?? '0') < req.sellAmount;

    const sources = (q.route?.fills ?? []).map((f) => f.source).filter((s, i, a) => a.indexOf(s) === i);
    return {
      request: req,
      buyAmount: BigInt(q.buyAmount),
      minBuyAmount: BigInt(q.minBuyAmount),
      integratorFee: q.fees?.integratorFee ? { amount: BigInt(q.fees.integratorFee.amount), token: q.fees.integratorFee.token } : undefined,
      networkFee: q.totalNetworkFee ? BigInt(q.totalNetworkFee) : payload.tx.gas * payload.tx.gasPrice,
      route: sources.join(' + ') || '0x',
      needsApproval,
      payload,
      expiresAt: Date.now() + 30_000,
    };
  }

  async execute(quote: SwapQuote, privateKey: Uint8Array): Promise<SwapResult> {
    const req = quote.request;
    if (!isEvm(req.chain)) throw new SwapError('Unsupported chain', 'unsupported');
    if (Date.now() > quote.expiresAt) throw new SwapError('Quote expired, refresh it', 'expired');
    const p = quote.payload as ZxPayload;
    // Re-validate the payload right before signing (defence in depth).
    assertExecCall(p.tx, req, p.chainId, CHAIN_IDS[req.chain]);

    const client = this.client(req.chain);
    const account = privateKeyToAccount(toHex(privateKey));
    if (account.address !== getAddress(req.taker)) throw new SwapError('Key does not match wallet', 'unsafe_quote');

    let nonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' });
    const gasPrice = await client.getGasPrice();
    let approvalTxid: string | undefined;

    if (quote.needsApproval) {
      if (!p.spender || lc(p.spender) !== lc(p.tx.to)) throw new SwapError('Unexpected approval target', 'unsafe_quote');
      const approve = async (amount: bigint) => {
        const data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [getAddress(p.spender!), amount] });
        const gas = await client.estimateGas({ account: account.address, to: getAddress(req.sell.address), data });
        const raw = await account.signTransaction({
          type: 'legacy', chainId: p.chainId, nonce, gas: (gas * 12n) / 10n, gasPrice, to: getAddress(req.sell.address), data, value: 0n,
        });
        const h = await client.sendRawTransaction({ serializedTransaction: raw });
        await client.waitForTransactionReceipt({ hash: h as Hex, timeout: 120_000 });
        nonce += 1;
        return h;
      };
      if (p.currentAllowance > 0n) await approve(0n); // USDT: non-zero -> non-zero approve reverts
      approvalTxid = await approve(req.sellAmount);
    }

    const gas = p.tx.gas > 0n ? (p.tx.gas * 12n) / 10n : (await client.estimateGas({ account: account.address, to: p.tx.to, data: p.tx.data, value: p.tx.value })) * 12n / 10n;
    const raw = await account.signTransaction({
      type: 'legacy', chainId: p.chainId, nonce, gas, gasPrice: gasPrice > p.tx.gasPrice ? gasPrice : p.tx.gasPrice,
      to: p.tx.to, data: p.tx.data, value: p.tx.value,
    });
    const txid = await client.sendRawTransaction({ serializedTransaction: raw });
    if (lc(txid) !== lc(keccak256(raw))) throw new SwapError('RPC returned unexpected tx hash', 'api');
    return { approvalTxid, txid };
  }
}

function assertExecCall(tx: ZxPayload['tx'], req: SwapRequest, payloadChainId: number, expectedChainId: number) {
  const fail = (m: string): never => { throw new SwapError(`Unsafe 0x transaction: ${m}`, 'unsafe_quote'); };
  if (payloadChainId !== expectedChainId) fail('chain mismatch');
  const sellNative = lc(req.sell.address) === lc(EVM_NATIVE);
  if (sellNative ? tx.value !== req.sellAmount : tx.value !== 0n) fail('unexpected native value');
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: allowanceHolderAbi, data: tx.data });
  } catch {
    return fail('not an AllowanceHolder.exec call');
  }
  const [, token, amount] = decoded.args;
  if (!sellNative) {
    if (lc(token) !== lc(req.sell.address)) fail('wrong sell token');
    if (amount !== req.sellAmount) fail('wrong sell amount');
  }
}

/** Validate a raw 0x quote against what we asked for. Exported for tests. */
export function validateZeroExQuote(q: ZxQuote, req: SwapRequest, chainId: number, slippageBps: number): ZxPayload {
  const fail = (m: string): never => { throw new SwapError(`Unsafe 0x quote: ${m}`, 'unsafe_quote'); };
  if (!q.liquidityAvailable) throw new SwapError('No liquidity for this pair', 'no_liquidity');
  if (lc(q.sellToken) !== lc(req.sell.address) || lc(q.buyToken) !== lc(req.buy.address)) fail('token mismatch');
  if (BigInt(q.sellAmount) !== req.sellAmount) fail('sell amount mismatch');
  checkSlippage(BigInt(q.buyAmount), BigInt(q.minBuyAmount), slippageBps);
  const t = q.transaction;
  if (!t || !isAddress(t.to)) return fail('missing transaction');
  const spender = q.issues?.allowance?.spender ?? null;
  const sellNative = lc(req.sell.address) === lc(EVM_NATIVE);
  if (!sellNative && spender && lc(spender) !== lc(t.to)) fail('allowance spender differs from transaction target');
  const tx = {
    to: getAddress(t.to), data: t.data as Hex, value: BigInt(t.value || '0'),
    gas: BigInt(t.gas ?? '0'), gasPrice: BigInt(t.gasPrice || '0'),
  };
  assertExecCall(tx, req, chainId, chainId);
  return { chainId, tx, spender: spender ? getAddress(spender) : null, currentAllowance: BigInt(q.issues?.allowance?.actual ?? '0') };
}
