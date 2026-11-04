/**
 * Limit orders on CoW Protocol (Ethereum, BNB Chain, Polygon; Sepolia for tests).
 *
 * A CoW order is an off-chain EIP-712 signature: funds stay in the user's wallet
 * until a solver fills the order at the user's price or better. We build the
 * order ourselves (nothing server-built is signed), so the user signs exactly:
 * "sell X of A for at least Y of B, until <date>, to my own address".
 *
 * Constants taken from @cowprotocol/sdk-contracts-ts / sdk-order-book v9.
 */
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  hashTypedData,
  http,
  keccak256,
  toBytes,
  toHex,
  concat,
  numberToHex,
  type Hex,
  type PublicClient,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { ChainId } from '../chains.js';

export const COW_SETTLEMENT = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41';
export const COW_VAULT_RELAYER = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110';
export const COW_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
/** keccak256 of the Order type string; asserted in tests against CoW's published constant */
export const COW_ORDER_TYPE_HASH = '0xd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489';

export const ORDER_TYPES = {
  Order: [
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount', type: 'uint256' },
    { name: 'validTo', type: 'uint32' },
    { name: 'appData', type: 'bytes32' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'kind', type: 'string' },
    { name: 'partiallyFillable', type: 'bool' },
    { name: 'sellTokenBalance', type: 'string' },
    { name: 'buyTokenBalance', type: 'string' },
  ],
} as const;

export const CANCELLATION_TYPES = { OrderCancellations: [{ name: 'orderUids', type: 'bytes[]' }] } as const;

type CowChain = 'ethereum' | 'bsc' | 'polygon';

interface Net { chainId: number; slug: string; wrapped: Hex }
const MAINNETS: Record<CowChain, Net> = {
  ethereum: { chainId: 1, slug: 'mainnet', wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }, // WETH
  bsc: { chainId: 56, slug: 'bnb', wrapped: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' }, // WBNB
  polygon: { chainId: 137, slug: 'polygon', wrapped: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' }, // WPOL
};
const SEPOLIA: Net = { chainId: 11155111, slug: 'sepolia', wrapped: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' }; // WETH

const wethAbi = [{ type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [], outputs: [] }] as const;

export interface LimitToken { address: string; symbol: string; decimals: number }

export interface LimitOrderRequest {
  chain: ChainId;
  owner: string;
  sell: LimitToken; // may be the native coin: it is wrapped first
  buy: LimitToken; // may be the native coin (CoW pays out native)
  sellAmount: bigint;
  /** Minimum to receive — this IS the limit price */
  buyAmount: bigint;
  /** Order lifetime in seconds (max 365 days) */
  validForSec: number;
}

export interface CowOrderMessage {
  sellToken: Hex;
  buyToken: Hex;
  receiver: Hex;
  sellAmount: bigint;
  buyAmount: bigint;
  validTo: number;
  appData: Hex;
  feeAmount: bigint;
  kind: 'sell';
  partiallyFillable: boolean;
  sellTokenBalance: 'erc20';
  buyTokenBalance: 'erc20';
}

export interface PreparedLimitOrder {
  request: LimitOrderRequest;
  chainId: number;
  order: CowOrderMessage;
  appData: string;
  /** Native amount to wrap first (selling ETH/BNB/POL), 0n if none */
  wrapAmount: bigint;
  /** Allowance to set for the vault relayer, or null if enough already */
  approveTo: bigint | null;
  /** Allowance before; USDT-style tokens need a reset to 0 before a new non-zero value */
  currentAllowance: bigint;
}

export type LimitOrderStatus = 'open' | 'filled' | 'cancelled' | 'expired' | 'pending';

export interface LimitOrderInfo {
  uid: string;
  chain: ChainId;
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  buyAmount: bigint;
  executedSell: bigint;
  executedBuy: bigint;
  validTo: number;
  created: string;
  status: LimitOrderStatus;
}

export class LimitOrderError extends Error {
  constructor(message: string, readonly code: 'invalid' | 'insufficient_funds' | 'api' | 'unsupported' | 'mismatch') {
    super(message);
  }
}

export interface CowOptions {
  rpc: Partial<Record<CowChain, string | Transport>>;
  /** Use Sepolia for `ethereum` (testnet mode); BSC/Polygon are then unsupported */
  testnet?: boolean;
  fetch?: typeof fetch;
  baseUrl?: string;
  appCode?: string;
  /** Partner fee (bps of volume) sent to `recipient` when an order fills */
  partnerFee?: { recipient: string; bps: number };
}

/** JSON.stringify with sorted keys, no whitespace (CoW's deterministic appData). */
export function stringifyDeterministic(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stringifyDeterministic).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stringifyDeterministic(o[k])}`).join(',')}}`;
}

export function domainFor(chainId: number) {
  return { name: 'Gnosis Protocol', version: 'v2', chainId, verifyingContract: COW_SETTLEMENT } as const;
}

/** uid = orderDigest (32) ‖ owner (20) ‖ validTo (4) */
export function computeOrderUid(chainId: number, order: CowOrderMessage, owner: string): Hex {
  const digest = hashTypedData({ domain: domainFor(chainId), types: ORDER_TYPES, primaryType: 'Order', message: order });
  return concat([digest, getAddress(owner), numberToHex(order.validTo, { size: 4 })]);
}

const isCow = (c: ChainId): c is CowChain => c === 'ethereum' || c === 'bsc' || c === 'polygon';
const lc = (s: string) => s.toLowerCase();

export class CowLimitOrders {
  private fetcher: typeof fetch;
  private clients = new Map<CowChain, PublicClient>();

  constructor(private opts: CowOptions) {
    this.fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    if (opts.partnerFee && (opts.partnerFee.bps < 0 || opts.partnerFee.bps > 100)) throw new Error('Partner fee must be 0–100 bps');
  }

  supports(chain: ChainId): boolean {
    if (!isCow(chain) || !this.opts.rpc[chain]) return false;
    return this.opts.testnet ? chain === 'ethereum' : true;
  }

  private net(chain: ChainId): Net {
    if (!this.supports(chain)) throw new LimitOrderError('Limit orders are not available on this network', 'unsupported');
    return this.opts.testnet ? SEPOLIA : MAINNETS[chain as CowChain];
  }

  private api(chain: ChainId, path: string) {
    return `${this.opts.baseUrl ?? 'https://api.cow.fi'}/${this.net(chain).slug}/api/v1${path}`;
  }

  private client(chain: CowChain): PublicClient {
    let c = this.clients.get(chain);
    if (!c) {
      const r = this.opts.rpc[chain]!;
      c = createPublicClient({ transport: typeof r === 'string' ? http(r) : r }) as PublicClient;
      this.clients.set(chain, c);
    }
    return c;
  }

  appDataDoc(): string {
    const metadata: Record<string, unknown> = { orderClass: { orderClass: 'limit' } };
    if (this.opts.partnerFee && this.opts.partnerFee.bps > 0) {
      metadata.partnerFee = { volumeBps: this.opts.partnerFee.bps, recipient: getAddress(this.opts.partnerFee.recipient) };
    }
    return stringifyDeterministic({ appCode: this.opts.appCode ?? 'Kript', metadata, version: '1.15.0' });
  }

  async prepare(req: LimitOrderRequest): Promise<PreparedLimitOrder> {
    const net = this.net(req.chain);
    if (req.sellAmount <= 0n || req.buyAmount <= 0n) throw new LimitOrderError('Amounts must be positive', 'invalid');
    if (lc(req.sell.address) === lc(req.buy.address)) throw new LimitOrderError('Same token', 'invalid');
    if (req.validForSec < 60 || req.validForSec > 365 * 86400) throw new LimitOrderError('Bad expiry', 'invalid');
    const owner = getAddress(req.owner);
    const sellNative = lc(req.sell.address) === lc(COW_NATIVE);
    const sellToken = sellNative ? net.wrapped : getAddress(req.sell.address);
    const buyToken = lc(req.buy.address) === lc(COW_NATIVE) ? (COW_NATIVE as Hex) : getAddress(req.buy.address);

    const client = this.client(req.chain as CowChain);
    const [native, tokenBal, allowance] = await Promise.all([
      client.getBalance({ address: owner }),
      client.readContract({ address: sellToken, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      client.readContract({ address: sellToken, abi: erc20Abi, functionName: 'allowance', args: [owner, COW_VAULT_RELAYER] }),
    ]);

    let wrapAmount = 0n;
    if (sellNative) {
      wrapAmount = tokenBal >= req.sellAmount ? 0n : req.sellAmount - tokenBal;
      if (native < wrapAmount) throw new LimitOrderError('Insufficient balance', 'insufficient_funds');
    } else if (tokenBal < req.sellAmount) {
      throw new LimitOrderError('Insufficient balance', 'insufficient_funds');
    }
    // Add to the existing allowance so other open orders on the same token keep working.
    const approveTo = allowance >= req.sellAmount ? null : allowance + req.sellAmount;

    const appData = this.appDataDoc();
    const order: CowOrderMessage = {
      sellToken, buyToken, receiver: owner,
      sellAmount: req.sellAmount, buyAmount: req.buyAmount,
      validTo: Math.floor(Date.now() / 1000) + req.validForSec,
      appData: keccak256(toBytes(appData)),
      feeAmount: 0n, kind: 'sell', partiallyFillable: false, sellTokenBalance: 'erc20', buyTokenBalance: 'erc20',
    };
    return { request: req, chainId: net.chainId, order, appData, wrapAmount, approveTo, currentAllowance: allowance };
  }

  async place(p: PreparedLimitOrder, privateKey: Uint8Array): Promise<{ uid: string; wrapTxid?: string; approveTxid?: string }> {
    const account = privateKeyToAccount(toHex(privateKey));
    if (account.address !== getAddress(p.request.owner)) throw new LimitOrderError('Key does not match wallet', 'mismatch');
    if (lc(p.order.receiver) !== lc(account.address)) throw new LimitOrderError('Receiver must be the owner', 'mismatch');
    if (p.order.appData !== keccak256(toBytes(p.appData))) throw new LimitOrderError('appData hash mismatch', 'mismatch');
    const client = this.client(p.request.chain as CowChain);

    let nonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' });
    const gasPrice = await client.getGasPrice();
    const send = async (to: Hex, data: Hex, value: bigint) => {
      const gas = await client.estimateGas({ account: account.address, to, data, value });
      const raw = await account.signTransaction({ type: 'legacy', chainId: p.chainId, nonce, gas: (gas * 12n) / 10n, gasPrice, to, data, value });
      const h = await client.sendRawTransaction({ serializedTransaction: raw });
      await client.waitForTransactionReceipt({ hash: h, timeout: 180_000 });
      nonce += 1;
      return h;
    };

    let wrapTxid: string | undefined;
    if (p.wrapAmount > 0n) wrapTxid = await send(p.order.sellToken, encodeFunctionData({ abi: wethAbi, functionName: 'deposit' }), p.wrapAmount);
    let approveTxid: string | undefined;
    if (p.approveTo !== null) {
      if (p.currentAllowance > 0n) {
        await send(p.order.sellToken, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [COW_VAULT_RELAYER, 0n] }), 0n);
      }
      approveTxid = await send(p.order.sellToken, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [COW_VAULT_RELAYER, p.approveTo] }), 0n);
    }

    const signature = await account.signTypedData({ domain: domainFor(p.chainId), types: ORDER_TYPES, primaryType: 'Order', message: p.order });
    const expectedUid = computeOrderUid(p.chainId, p.order, account.address);
    const body = {
      sellToken: p.order.sellToken, buyToken: p.order.buyToken, receiver: p.order.receiver,
      sellAmount: p.order.sellAmount.toString(), buyAmount: p.order.buyAmount.toString(),
      validTo: p.order.validTo, feeAmount: '0', kind: 'sell', partiallyFillable: false,
      sellTokenBalance: 'erc20', buyTokenBalance: 'erc20', signingScheme: 'eip712', signature,
      from: account.address, appData: p.appData, appDataHash: p.order.appData,
    };
    const r = await this.fetcher(this.api(p.request.chain, '/orders'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new LimitOrderError(`CoW rejected the order: ${text}`, 'api');
    const uid = JSON.parse(text) as string;
    if (lc(uid) !== lc(expectedUid)) throw new LimitOrderError('Order id mismatch', 'mismatch');
    return { uid, wrapTxid, approveTxid };
  }

  async list(chain: ChainId, owner: string): Promise<LimitOrderInfo[]> {
    const r = await this.fetcher(this.api(chain, `/account/${getAddress(owner)}/orders?limit=100`));
    if (!r.ok) throw new LimitOrderError(`CoW API ${r.status}`, 'api');
    const rows = (await r.json()) as Array<Record<string, string | number>>;
    const statusMap: Record<string, LimitOrderStatus> = {
      open: 'open', fulfilled: 'filled', cancelled: 'cancelled', expired: 'expired', presignaturePending: 'pending',
    };
    return rows.map((o) => ({
      uid: String(o.uid), chain,
      sellToken: String(o.sellToken), buyToken: String(o.buyToken),
      sellAmount: BigInt(o.sellAmount!), buyAmount: BigInt(o.buyAmount!),
      executedSell: BigInt(o.executedSellAmount ?? 0), executedBuy: BigInt(o.executedBuyAmount ?? 0),
      validTo: Number(o.validTo), created: String(o.creationDate ?? ''),
      status: statusMap[String(o.status)] ?? 'pending',
    }));
  }

  /** Off-chain cancellation signed by the owner (free, no gas). */
  async cancel(chain: ChainId, uid: Hex, privateKey: Uint8Array): Promise<void> {
    const net = this.net(chain);
    const account = privateKeyToAccount(toHex(privateKey));
    if (lc(`0x${uid.slice(66, 106)}`) !== lc(account.address)) throw new LimitOrderError('Not your order', 'mismatch');
    const signature = await account.signTypedData({
      domain: domainFor(net.chainId), types: CANCELLATION_TYPES, primaryType: 'OrderCancellations', message: { orderUids: [uid] },
    });
    const r = await this.fetcher(this.api(chain, '/orders'), {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderUids: [uid], signature, signingScheme: 'eip712' }),
    });
    if (!r.ok) throw new LimitOrderError(`Cancel failed: ${await r.text()}`, 'api');
  }
}
