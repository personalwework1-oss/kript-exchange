/**
 * Bitcoin (native SegWit, P2WPKH) via an Esplora-compatible API
 * (mempool.space, blockstream.info, or a self-hosted Esplora/electrs).
 */
import { Address, OutScript, p2wpkh, NETWORK, TEST_NETWORK, selectUTXO, Transaction } from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hex } from '@scure/base';
import {
  assertPositive,
  TransferError,
  type Balances,
  type NetworkAdapter,
  type PreparedTransfer,
  type SignedTransfer,
  type TransferRequest,
} from './types.js';
import type { BitcoinNetwork } from '../derive.js';

export interface BitcoinAdapterOptions {
  network?: BitcoinNetwork;
  /** Esplora base URL without trailing slash, e.g. https://mempool.space/api */
  esploraUrl: string;
  fetch?: typeof fetch;
  /** Which mempool.space fee bucket to use */
  feeSpeed?: 'fastestFee' | 'halfHourFee' | 'hourFee';
  /** Only spend confirmed outputs (safer); default true */
  confirmedOnly?: boolean;
}

interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

interface BtcPayload {
  psbt: string; // hex, unsigned
  inputs: number;
}

/** Hard cap: refuse fee rates above this (sat/vB) — protects from a broken/malicious fee API. */
const MAX_FEE_RATE = 1000n;

export class BitcoinAdapter implements NetworkAdapter {
  readonly chain = 'bitcoin' as const;
  private net;
  private fetcher: typeof fetch;

  constructor(private opts: BitcoinAdapterOptions) {
    this.net = (opts.network ?? 'mainnet') === 'mainnet' ? NETWORK : TEST_NETWORK;
    this.fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  validateAddress(address: string): boolean {
    try {
      Address(this.net).decode(address);
      return true;
    } catch {
      return false;
    }
  }

  private async get<T>(path: string): Promise<T> {
    const r = await this.fetcher(`${this.opts.esploraUrl}${path}`);
    if (!r.ok) throw new Error(`Esplora ${path}: HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  private async utxos(address: string): Promise<EsploraUtxo[]> {
    const list = await this.get<EsploraUtxo[]>(`/address/${address}/utxo`);
    return (this.opts.confirmedOnly ?? true) ? list.filter((u) => u.status.confirmed) : list;
  }

  async getTokenBalances(): Promise<Record<string, bigint>> {
    return {}; // Bitcoin has no tokens
  }

  async tokenMetadata(): Promise<never> {
    throw new TransferError('Bitcoin has no tokens', 'unsupported');
  }

  async getBalances(address: string): Promise<Balances> {
    if (!this.validateAddress(address)) throw new TransferError('Invalid address', 'invalid_address');
    const list = await this.get<EsploraUtxo[]>(`/address/${address}/utxo`);
    const native = list.reduce((s, u) => s + BigInt(u.value), 0n);
    return { chain: 'bitcoin', address, native };
  }

  async feeRate(): Promise<bigint> {
    let rate: number | undefined;
    try {
      const f = await this.get<Record<string, number>>('/v1/fees/recommended'); // mempool.space
      rate = f[this.opts.feeSpeed ?? 'halfHourFee'];
    } catch {
      const f = await this.get<Record<string, number>>('/fee-estimates'); // blockstream esplora
      rate = f['3'];
    }
    if (!rate || !Number.isFinite(rate) || rate <= 0) throw new Error('Fee estimate unavailable');
    const r = BigInt(Math.ceil(rate));
    if (r > MAX_FEE_RATE) throw new Error(`Fee rate ${r} sat/vB looks wrong; refusing`);
    return r;
  }

  async prepareTransfer(req: TransferRequest): Promise<PreparedTransfer> {
    if (req.asset !== 'native') throw new TransferError('Bitcoin has no USDT', 'unsupported');
    assertPositive(req.amount);
    if (!this.validateAddress(req.from) || !this.validateAddress(req.to)) {
      throw new TransferError('Invalid address', 'invalid_address');
    }
    if (req.from === req.to) throw new TransferError('Sending to yourself', 'self_transfer');

    const [utxos, feePerByte] = await Promise.all([this.utxos(req.from), this.feeRate()]);
    const fromScript = OutScript.encode(Address(this.net).decode(req.from));
    const inputs = utxos.map((u) => ({
      txid: u.txid,
      index: u.vout,
      witnessUtxo: { script: fromScript, amount: BigInt(u.value) },
    }));

    const sel = selectUTXO(inputs, [{ address: req.to, amount: req.amount }], 'default', {
      feePerByte,
      changeAddress: req.from,
      network: this.net,
      bip69: true,
      createTx: true,
    });
    if (!sel || !sel.tx || sel.fee === undefined) {
      throw new TransferError('Insufficient balance (amount + network fee)', 'insufficient_funds');
    }
    const payload: BtcPayload = { psbt: hex.encode(sel.tx.toPSBT()), inputs: sel.inputs.length };
    return {
      request: req,
      fee: { amount: sel.fee, symbol: 'BTC', note: `${feePerByte} sat/vB` },
      payload,
    };
  }

  async signTransfer(prepared: PreparedTransfer, privateKey: Uint8Array): Promise<SignedTransfer> {
    const { psbt } = prepared.payload as BtcPayload;
    const tx = Transaction.fromPSBT(hex.decode(psbt));
    // Make sure the key really owns the sender address before signing anything.
    const own = p2wpkh(secp256k1.getPublicKey(privateKey, true), this.net).address;
    if (own !== prepared.request.from) throw new TransferError('Key does not match sender', 'verification_failed');
    // Re-check outputs: recipient gets exactly `amount`, everything else goes back to us.
    let toRecipient = 0n;
    for (let i = 0; i < tx.outputsLength; i++) {
      const o = tx.getOutput(i);
      const addr = Address(this.net).encode(OutScript.decode(o.script!));
      if (addr === prepared.request.to) toRecipient += o.amount!;
      else if (addr !== prepared.request.from) throw new TransferError('Unexpected output in transaction', 'verification_failed');
    }
    if (toRecipient !== prepared.request.amount) throw new TransferError('Output amount mismatch', 'verification_failed');
    if (tx.fee !== prepared.fee.amount) throw new TransferError('Fee mismatch', 'verification_failed');

    tx.sign(privateKey);
    tx.finalize();
    return { chain: 'bitcoin', raw: tx.hex, txid: tx.id };
  }

  async broadcast(signed: SignedTransfer): Promise<string> {
    const r = await this.fetcher(`${this.opts.esploraUrl}/tx`, { method: 'POST', body: signed.raw });
    const text = await r.text();
    if (!r.ok) throw new Error(`Broadcast failed: ${text}`);
    return text.trim();
  }

  explorerTxUrl(txid: string): string {
    const testnet = this.net !== NETWORK;
    return `https://mempool.space/${testnet ? 'testnet4/' : ''}tx/${txid}`;
  }
}
