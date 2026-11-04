/**
 * Tron: TRX and USDT (TRC20).
 *
 * Transactions are built by a full node (TronGrid), so the result is treated as
 * untrusted: before signing we check that raw_data_hex really encodes raw_data,
 * that txID = sha256(raw_data_hex), and that the contract call is exactly
 * "transfer <amount> USDT to <recipient>" from our address.
 */
import { TronWeb, utils as tronUtils } from 'tronweb';
import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from '@scure/base';
import { USDT } from '../chains.js';
import { isValidTronAddress, tronAddressFromPublicKey } from '../derive.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { decodeAbiParameters, type Hex } from 'viem';
import {
  assertPositive,
  TransferError,
  type DiscoveredToken,
  type TokenMeta,
  type Balances,
  type NetworkAdapter,
  type PreparedTransfer,
  type SignedTransfer,
  type TransferRequest,
} from './types.js';

export interface TronAdapterOptions {
  /** e.g. https://api.trongrid.io (mainnet), https://nile.trongrid.io (testnet) */
  fullHost: string;
  apiKey?: string;
  /** Override token address (testnets use different USDT contracts) */
  usdtAddress?: string;
  /** Max TRX burned for a TRC20 call, in sun. Default 50 TRX. */
  feeLimitSun?: number;
  /** For tests: a pre-built TronWeb instance */
  tronWeb?: TronWeb;
  fetch?: typeof fetch;
}

const TRANSFER_SELECTOR = 'a9059cbb';
const SUN = 1_000_000n;

type TronTx = {
  txID: string;
  raw_data: { contract: Array<{ type: string; parameter: { value: Record<string, unknown> } }>; [k: string]: unknown };
  raw_data_hex: string;
  signature?: string[];
};

function toHex41(addr: string): string {
  return TronWeb.address.toHex(addr).toLowerCase();
}

/** Verify a node-built transaction before signing. Exported for tests. */
export function verifyTronTransfer(tx: TronTx, req: TransferRequest, usdtAddress: string): void {
  const fail = (m: string): never => {
    throw new TransferError(`Tron tx verification failed: ${m}`, 'verification_failed');
  };
  if (!tronUtils.transaction.txCheck(tx)) fail('raw_data_hex does not match raw_data');
  if (hex.encode(sha256(hex.decode(tx.raw_data_hex))) !== tx.txID.toLowerCase()) fail('txID mismatch');
  const contracts = tx.raw_data.contract;
  if (contracts.length !== 1) fail('expected exactly one contract');
  const c = contracts[0]!;
  const v = c.parameter.value as Record<string, string | number>;
  if (String(v.owner_address).toLowerCase() !== toHex41(req.from)) fail('wrong sender');

  if (req.asset === 'native') {
    if (c.type !== 'TransferContract') fail('not a TRX transfer');
    if (String(v.to_address).toLowerCase() !== toHex41(req.to)) fail('wrong recipient');
    if (BigInt(v.amount as number) !== req.amount) fail('wrong amount');
    return;
  }
  if (c.type !== 'TriggerSmartContract') fail('not a contract call');
  if (String(v.contract_address).toLowerCase() !== toHex41(usdtAddress)) fail('wrong token contract');
  if (v.call_value && BigInt(v.call_value as number) !== 0n) fail('unexpected TRX value');
  const data = String(v.data).toLowerCase();
  if (data.length !== 8 + 64 + 64 || !data.startsWith(TRANSFER_SELECTOR)) fail('not a transfer() call');
  const toWord = data.slice(8, 72);
  const amountWord = data.slice(72);
  // ABI address = 12 zero bytes + 20-byte address (without the 0x41 prefix)
  if (toWord !== '0'.repeat(24) + toHex41(req.to).slice(2)) fail('wrong recipient');
  if (BigInt('0x' + amountWord) !== req.amount) fail('wrong amount');
}

export class TronAdapter implements NetworkAdapter {
  readonly chain = 'tron' as const;
  private tw: TronWeb;
  private usdt: string;
  private feeLimit: number;

  constructor(private opts: TronAdapterOptions) {
    this.tw =
      opts.tronWeb ??
      new TronWeb({ fullHost: opts.fullHost, headers: opts.apiKey ? { 'TRON-PRO-API-KEY': opts.apiKey } : undefined });
    this.usdt = opts.usdtAddress ?? USDT.tron.address;
    this.feeLimit = opts.feeLimitSun ?? 50_000_000;
  }

  validateAddress(address: string): boolean {
    return isValidTronAddress(address);
  }

  async getBalances(address: string): Promise<Balances> {
    if (!this.validateAddress(address)) throw new TransferError('Invalid address', 'invalid_address');
    const native = BigInt(await this.tw.trx.getBalance(address));
    const res = await this.tw.transactionBuilder.triggerConstantContract(
      this.usdt, 'balanceOf(address)', {}, [{ type: 'address', value: address }], address,
    );
    const word = res.constant_result?.[0];
    const usdt = word ? BigInt('0x' + word) : 0n;
    return { chain: 'tron', address, native, usdt };
  }

  private tokenAddr(req: TransferRequest): string {
    if (req.asset === 'usdt') return this.usdt;
    if (req.asset === 'token' && req.token && isValidTronAddress(req.token.address)) return req.token.address;
    throw new TransferError('Unsupported token', 'unsupported');
  }

  private async constant(contract: string, sig: string, params: Array<{ type: string; value: unknown }>, from: string): Promise<Hex | null> {
    const r = await this.tw.transactionBuilder.triggerConstantContract(contract, sig, {}, params as never, from);
    const w = r.constant_result?.[0];
    return r.result?.result !== false && w ? (`0x${w}` as Hex) : null;
  }

  async getTokenBalances(address: string, tokens: string[]): Promise<Record<string, bigint>> {
    const vals = await Promise.all(tokens.map((t) =>
      this.constant(t, 'balanceOf(address)', [{ type: 'address', value: address }], address).catch(() => null)));
    return Object.fromEntries(tokens.map((t, i) => [t, vals[i] ? BigInt(vals[i]!) : 0n]));
  }

  async tokenMetadata(token: string): Promise<TokenMeta> {
    if (!isValidTronAddress(token)) throw new TransferError('Invalid token address', 'unsupported');
    const from = token;
    const [d, sym, name] = await Promise.all([
      this.constant(token, 'decimals()', [], from).catch(() => null),
      this.constant(token, 'symbol()', [], from).catch(() => null),
      this.constant(token, 'name()', [], from).catch(() => null),
    ]);
    if (!d) throw new TransferError('Not a TRC20 token', 'unsupported');
    const str = (h: Hex | null) => {
      if (!h) return undefined;
      try { return decodeAbiParameters([{ type: 'string' }], h)[0]; } catch { return undefined; }
    };
    return { decimals: Number(BigInt(d)), symbol: str(sym), name: str(name) };
  }

  /** TronGrid lists all TRC20 balances of an account. */
  async discoverTokens(address: string): Promise<DiscoveredToken[]> {
    const f = this.opts.fetch ?? globalThis.fetch.bind(globalThis);
    const r = await f(`${this.opts.fullHost}/v1/accounts/${address}`, {
      headers: this.opts.apiKey ? { 'TRON-PRO-API-KEY': this.opts.apiKey } : {},
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: Array<{ trc20?: Array<Record<string, string>> }> };
    return (j.data?.[0]?.trc20 ?? [])
      .flatMap((o) => Object.entries(o))
      .filter(([a]) => isValidTronAddress(a))
      .map(([a, v]) => ({ address: a, amount: BigInt(v) }))
      .filter((t) => t.amount > 0n);
  }

  /** Rough TRX burn for a token transfer, after the account's own energy/bandwidth. */
  private async estimateUsdtFee(req: TransferRequest): Promise<bigint> {
    const sim = await this.tw.transactionBuilder.triggerConstantContract(
      this.tokenAddr(req), 'transfer(address,uint256)', {},
      [{ type: 'address', value: req.to }, { type: 'uint256', value: req.amount.toString() }], req.from,
    );
    const energyNeeded = BigInt(sim.energy_used ?? 0);
    const [res, params] = await Promise.all([
      this.tw.trx.getAccountResources(req.from),
      this.tw.trx.getChainParameters(),
    ]);
    const energyAvail = BigInt((res.EnergyLimit ?? 0) - (res.EnergyUsed ?? 0));
    const energyFee = BigInt(params.find((p: { key: string }) => p.key === 'getEnergyFee')?.value ?? 100);
    const missing = energyNeeded > energyAvail ? energyNeeded - energyAvail : 0n;
    return missing * energyFee + SUN / 2n; // + ~0.5 TRX bandwidth headroom
  }

  async prepareTransfer(req: TransferRequest): Promise<PreparedTransfer> {
    assertPositive(req.amount);
    if (!this.validateAddress(req.from) || !this.validateAddress(req.to)) {
      throw new TransferError('Invalid address', 'invalid_address');
    }
    if (req.from === req.to) throw new TransferError('Sending to yourself', 'self_transfer');
    const token = req.asset === 'native' ? null : this.tokenAddr(req);
    if (token && req.to === token) throw new TransferError('Recipient is the token contract', 'invalid_address');
    if (req.amount > BigInt(Number.MAX_SAFE_INTEGER) && req.asset === 'native') {
      throw new TransferError('Amount too large', 'invalid_amount');
    }

    const balances = await this.getBalances(req.from);
    let tx: TronTx;
    let fee: bigint;
    if (req.asset === 'native') {
      if (balances.native < req.amount) throw new TransferError('Insufficient balance', 'insufficient_funds');
      tx = (await this.tw.transactionBuilder.sendTrx(req.to, Number(req.amount), req.from)) as unknown as TronTx;
      fee = SUN / 2n; // bandwidth; usually free (daily free bandwidth)
    } else {
      const tokenBal = req.asset === 'usdt' ? (balances.usdt ?? 0n) : ((await this.getTokenBalances(req.from, [token!]))[token!] ?? 0n);
      if (tokenBal < req.amount) throw new TransferError('Insufficient token balance', 'insufficient_funds');
      fee = await this.estimateUsdtFee(req);
      if (balances.native < fee) throw new TransferError('Not enough TRX for the network fee', 'insufficient_fee');
      const built = await this.tw.transactionBuilder.triggerSmartContract(
        token!, 'transfer(address,uint256)', { feeLimit: this.feeLimit, callValue: 0 },
        [{ type: 'address', value: req.to }, { type: 'uint256', value: req.amount.toString() }], req.from,
      );
      if (!built.result?.result) throw new Error('Node refused to build the transaction');
      tx = built.transaction as unknown as TronTx;
    }
    verifyTronTransfer(tx, req, token ?? this.usdt);
    return { request: req, fee: { amount: fee, symbol: 'TRX', note: 'Estimate' }, payload: { tx } };
  }

  async signTransfer(prepared: PreparedTransfer, privateKey: Uint8Array): Promise<SignedTransfer> {
    const { tx } = prepared.payload as { tx: TronTx };
    if (tronAddressFromPublicKey(secp256k1.getPublicKey(privateKey, false)) !== prepared.request.from) {
      throw new TransferError('Key does not match sender', 'verification_failed');
    }
    const r = prepared.request;
    verifyTronTransfer(tx, r, r.asset === 'native' ? this.usdt : this.tokenAddr(r)); // re-check right before signing
    const signed = (await this.tw.trx.sign(tx as never, hex.encode(privateKey))) as unknown as TronTx;
    return { chain: 'tron', raw: JSON.stringify(signed), txid: signed.txID };
  }

  async broadcast(signed: SignedTransfer): Promise<string> {
    const res = await this.tw.trx.sendRawTransaction(JSON.parse(signed.raw));
    if (!res.result) throw new Error(`Broadcast failed: ${JSON.stringify(res)}`);
    return signed.txid;
  }

  explorerTxUrl(txid: string): string {
    return `https://tronscan.org/#/transaction/${txid}`;
  }
}
