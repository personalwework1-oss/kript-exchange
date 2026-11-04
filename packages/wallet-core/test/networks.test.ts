/**
 * Offline tests for chain adapters: RPCs are mocked, and every signed
 * transaction is decoded by an independent library to check recipient,
 * amount, sender and signature.
 */
import { describe, it, expect } from 'vitest';
import { custom, decodeFunctionData, erc20Abi, parseTransaction, recoverTransactionAddress, numberToHex, type Hex } from 'viem';
import * as bitcoin from 'bitcoinjs-lib';
import { Transaction as SolTx, SystemInstruction, PublicKey, Keypair } from '@solana/web3.js';
import { decodeTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { TronWeb, utils as tronUtils } from 'tronweb';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hex } from '@scure/base';
import {
  BitcoinAdapter,
  deriveAccounts,
  derivePrivateKey,
  EvmAdapter,
  generateMnemonic,
  SolanaAdapter,
  TransferError,
  TronAdapter,
  tronAddressFromPublicKey,
  USDT,
  verifyTronTransfer,
} from '../src/index.js';

const m = generateMnemonic();
const me = deriveAccounts(m);
const other = deriveAccounts(generateMnemonic());

// ───────────────────────────── EVM ─────────────────────────────
function evmMock(opts: { native: bigint; usdt: bigint }) {
  return custom({
    async request({ method }: { method: string; params?: unknown[] }) {
      switch (method) {
        case 'eth_getBalance': return numberToHex(opts.native);
        case 'eth_call': return numberToHex(opts.usdt, { size: 32 });
        case 'eth_getTransactionCount': return '0x7';
        case 'eth_estimateGas': return numberToHex(50_000n);
        case 'eth_gasPrice': return numberToHex(3_000_000_000n);
        case 'eth_maxPriorityFeePerGas': return numberToHex(1_000_000_000n);
        case 'eth_getBlockByNumber': return { baseFeePerGas: numberToHex(20_000_000_000n), number: '0x1', hash: '0x' + '11'.repeat(32), timestamp: '0x1', transactions: [] };
        case 'eth_chainId': return '0x1';
        default: throw new Error(`unexpected ${method}`);
      }
    },
  });
}

describe('EVM adapter', () => {
  const key = derivePrivateKey(m, 'evm');

  for (const chain of ['ethereum', 'bsc', 'polygon'] as const) {
    it(`${chain}: USDT transfer is signed by us and pays the right recipient`, async () => {
      const a = new EvmAdapter({ chain, transport: evmMock({ native: 10n ** 18n, usdt: 10n ** 20n }) });
      const p = await a.prepareTransfer({ chain, asset: 'usdt', from: me.evm.address, to: other.evm.address, amount: 123_456n });
      const s = await a.signTransfer(p, key);
      const tx = parseTransaction(s.raw as Hex);
      expect(await recoverTransactionAddress({ serializedTransaction: s.raw as never })).toBe(me.evm.address);
      expect(tx.to?.toLowerCase()).toBe(USDT[chain].address.toLowerCase());
      expect(tx.chainId).toBe({ ethereum: 1, bsc: 56, polygon: 137 }[chain]);
      expect(tx.type).toBe(chain === 'bsc' ? 'legacy' : 'eip1559');
      const d = decodeFunctionData({ abi: erc20Abi, data: tx.data! });
      expect(d.functionName).toBe('transfer');
      expect(d.args).toEqual([other.evm.address, 123_456n]);
      expect(tx.value ?? 0n).toBe(0n);
    });
  }

  it('native transfer sets value and nonce', async () => {
    const a = new EvmAdapter({ chain: 'ethereum', transport: evmMock({ native: 10n ** 18n, usdt: 0n }) });
    const p = await a.prepareTransfer({ chain: 'ethereum', asset: 'native', from: me.evm.address, to: other.evm.address, amount: 10n ** 15n });
    const tx = parseTransaction((await a.signTransfer(p, key)).raw as Hex);
    expect(tx.value).toBe(10n ** 15n);
    expect(tx.nonce).toBe(7);
    expect(tx.to?.toLowerCase()).toBe(other.evm.address.toLowerCase());
  });

  it('refuses: no gas money, bad checksum, sending to USDT contract, wrong key', async () => {
    const poor = new EvmAdapter({ chain: 'ethereum', transport: evmMock({ native: 0n, usdt: 10n ** 9n }) });
    await expect(poor.prepareTransfer({ chain: 'ethereum', asset: 'usdt', from: me.evm.address, to: other.evm.address, amount: 1n }))
      .rejects.toMatchObject({ code: 'insufficient_fee' });
    const a = new EvmAdapter({ chain: 'ethereum', transport: evmMock({ native: 10n ** 18n, usdt: 10n ** 9n }) });
    const badChecksum = other.evm.address.slice(0, 2) + other.evm.address.slice(2, 3).toLowerCase() === other.evm.address.slice(0, 3)
      ? other.evm.address.replace(/[a-f]/, (c) => c.toUpperCase())
      : other.evm.address.replace(/[A-F]/, (c) => c.toLowerCase());
    expect(a.validateAddress(badChecksum)).toBe(false);
    await expect(a.prepareTransfer({ chain: 'ethereum', asset: 'usdt', from: me.evm.address, to: USDT.ethereum.address, amount: 1n }))
      .rejects.toBeInstanceOf(TransferError);
    const p = await a.prepareTransfer({ chain: 'ethereum', asset: 'usdt', from: me.evm.address, to: other.evm.address, amount: 1n });
    await expect(a.signTransfer(p, derivePrivateKey(generateMnemonic(), 'evm'))).rejects.toMatchObject({ code: 'verification_failed' });
  });
});

// ─────────────────────────── Bitcoin ───────────────────────────
function btcFetch(utxos: Array<{ value: number; confirmed?: boolean }>, rate = 10) {
  return (async (url: string) => {
    const u = String(url);
    if (u.endsWith('/utxo')) {
      return new Response(JSON.stringify(utxos.map((x, i) => ({
        txid: hex.encode(Uint8Array.from({ length: 32 }, (_, j) => (i * 7 + j) & 255)), vout: i, value: x.value,
        status: { confirmed: x.confirmed ?? true },
      }))));
    }
    if (u.endsWith('/v1/fees/recommended')) return new Response(JSON.stringify({ fastestFee: rate * 2, halfHourFee: rate, hourFee: 1 }));
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('Bitcoin adapter', () => {
  const key = derivePrivateKey(m, 'bitcoin');

  it('builds, signs and pays exact amount with change back to us', async () => {
    const a = new BitcoinAdapter({ esploraUrl: 'https://x/api', fetch: btcFetch([{ value: 50_000 }, { value: 120_000 }, { value: 9_000, confirmed: false }]) });
    const p = await a.prepareTransfer({ chain: 'bitcoin', asset: 'native', from: me.bitcoin.address, to: other.bitcoin.address, amount: 100_000n });
    const s = await a.signTransfer(p, key);
    const tx = bitcoin.Transaction.fromHex(s.raw);
    expect(tx.getId()).toBe(s.txid);
    const outs = tx.outs.map((o) => ({ addr: bitcoin.address.fromOutputScript(o.script), value: BigInt(o.value) }));
    expect(outs.find((o) => o.addr === other.bitcoin.address)?.value).toBe(100_000n);
    for (const o of outs) expect([me.bitcoin.address, other.bitcoin.address]).toContain(o.addr);
    // every input is spent by our pubkey, with a witness signature
    for (const i of tx.ins) {
      expect(i.witness).toHaveLength(2);
      expect(hex.encode(i.witness[1]!)).toBe(me.bitcoin.publicKey);
    }
    // fee is sane: ~10 sat/vB
    const vsize = tx.virtualSize();
    expect(Number(p.fee.amount) / vsize).toBeGreaterThanOrEqual(9.5);
    expect(Number(p.fee.amount) / vsize).toBeLessThan(12);
  });

  it('does not spend unconfirmed coins and reports insufficient funds', async () => {
    const a = new BitcoinAdapter({ esploraUrl: 'https://x/api', fetch: btcFetch([{ value: 10_000 }, { value: 900_000, confirmed: false }]) });
    await expect(a.prepareTransfer({ chain: 'bitcoin', asset: 'native', from: me.bitcoin.address, to: other.bitcoin.address, amount: 50_000n }))
      .rejects.toMatchObject({ code: 'insufficient_funds' });
  });

  it('refuses a tampered payload and a crazy fee rate', async () => {
    const a = new BitcoinAdapter({ esploraUrl: 'https://x/api', fetch: btcFetch([{ value: 200_000 }]) });
    const p = await a.prepareTransfer({ chain: 'bitcoin', asset: 'native', from: me.bitcoin.address, to: other.bitcoin.address, amount: 10_000n });
    const tampered = { ...p, request: { ...p.request, to: deriveAccounts(generateMnemonic()).bitcoin.address } };
    await expect(a.signTransfer(tampered, key)).rejects.toMatchObject({ code: 'verification_failed' });
    const crazy = new BitcoinAdapter({ esploraUrl: 'https://x/api', fetch: btcFetch([{ value: 200_000 }], 5000) });
    await expect(crazy.prepareTransfer({ chain: 'bitcoin', asset: 'native', from: me.bitcoin.address, to: other.bitcoin.address, amount: 10_000n }))
      .rejects.toThrow(/refusing/);
  });

  it('validates addresses per network', () => {
    const a = new BitcoinAdapter({ esploraUrl: 'https://x/api' });
    expect(a.validateAddress(me.bitcoin.address)).toBe(true);
    expect(a.validateAddress(deriveAccounts(m, { bitcoinNetwork: 'testnet' }).bitcoin.address)).toBe(false);
    expect(a.validateAddress('bc1qinvalid')).toBe(false);
  });
});

// ───────────────────────────── Tron ─────────────────────────────
function tronUsdtTx(from: string, to: string, amount: bigint, contract = USDT.tron.address) {
  const toWord = '0'.repeat(24) + TronWeb.address.toHex(to).slice(2);
  const raw_data = {
    contract: [{
      parameter: {
        value: {
          data: 'a9059cbb' + toWord + amount.toString(16).padStart(64, '0'),
          owner_address: TronWeb.address.toHex(from),
          contract_address: TronWeb.address.toHex(contract),
        },
        type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
      },
      type: 'TriggerSmartContract',
    }],
    ref_block_bytes: 'abcd', ref_block_hash: '0123456789abcdef',
    expiration: 1_900_000_060_000, fee_limit: 50_000_000, timestamp: 1_900_000_000_000,
  };
  const pb = tronUtils.transaction.txJsonToPb({ raw_data });
  return { visible: false, raw_data, raw_data_hex: tronUtils.transaction.txPbToRawDataHex(pb), txID: tronUtils.transaction.txPbToTxID(pb).replace(/^0x/, '') };
}

describe('Tron adapter', () => {
  const req = { chain: 'tron' as const, asset: 'usdt' as const, from: me.tron.address, to: other.tron.address, amount: 25_000_000n };

  it('accepts an honest node-built USDT transfer', () => {
    expect(() => verifyTronTransfer(tronUsdtTx(req.from, req.to, req.amount), req, USDT.tron.address)).not.toThrow();
  });

  it('rejects a node that swaps recipient, amount, token or forges raw_data_hex', () => {
    const evil = deriveAccounts(generateMnemonic()).tron.address;
    const cases = [
      tronUsdtTx(req.from, evil, req.amount),
      tronUsdtTx(req.from, req.to, req.amount + 1n),
      tronUsdtTx(req.from, req.to, req.amount, 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj'),
      { ...tronUsdtTx(req.from, req.to, req.amount), raw_data_hex: tronUsdtTx(req.from, evil, req.amount).raw_data_hex },
    ];
    for (const tx of cases) expect(() => verifyTronTransfer(tx as never, req, USDT.tron.address)).toThrow(TransferError);
  });

  it('signs offline; signature recovers to our address', async () => {
    const a = new TronAdapter({ fullHost: 'http://127.0.0.1:1', tronWeb: new TronWeb({ fullHost: 'http://127.0.0.1:1' }) });
    const tx = tronUsdtTx(req.from, req.to, req.amount);
    const key = derivePrivateKey(m, 'tron');
    const s = await a.signTransfer({ request: req, fee: { amount: 0n, symbol: 'TRX' }, payload: { tx } }, key);
    const signed = JSON.parse(s.raw);
    const sig = hex.decode(signed.signature[0]);
    const recovery = sig[64]! >= 27 ? sig[64]! - 27 : sig[64]!;
    const pub = secp256k1.Signature.fromBytes(sig.slice(0, 64), 'compact').addRecoveryBit(recovery).recoverPublicKey(hex.decode(tx.txID)).toBytes(false);
    expect(tronAddressFromPublicKey(pub)).toBe(me.tron.address);
    expect(s.txid).toBe(tx.txID);
  });
});

// ──────────────────────────── Solana ────────────────────────────
describe('Solana adapter', () => {
  const a = new SolanaAdapter({ rpcUrl: 'http://127.0.0.1:1' });
  const key = derivePrivateKey(m, 'solana');
  const blockhash = Keypair.generate().publicKey.toBase58();

  it('SOL transfer: valid signature, right recipient and amount', async () => {
    const req = { chain: 'solana' as const, asset: 'native' as const, from: me.solana.address, to: other.solana.address, amount: 1_500_000n };
    const s = await a.signWithBlockhash({ request: req, fee: { amount: 0n, symbol: 'SOL' }, payload: { createsRecipientAccount: false } }, key, blockhash, 100);
    const tx = SolTx.from(Buffer.from(s.raw, 'base64'));
    expect(tx.verifySignatures()).toBe(true);
    expect(tx.feePayer?.toBase58()).toBe(me.solana.address);
    const t = SystemInstruction.decodeTransfer(tx.instructions.at(-1)!);
    expect(t.toPubkey.toBase58()).toBe(other.solana.address);
    expect(t.lamports).toBe(1_500_000n);
  });

  it('USDT transfer goes to the recipient ATA with checked decimals and creates it if needed', async () => {
    const req = { chain: 'solana' as const, asset: 'usdt' as const, from: me.solana.address, to: other.solana.address, amount: 7_000_000n };
    const s = await a.signWithBlockhash({ request: req, fee: { amount: 0n, symbol: 'SOL' }, payload: { createsRecipientAccount: true } }, key, blockhash, 100);
    const tx = SolTx.from(Buffer.from(s.raw, 'base64'));
    expect(tx.verifySignatures()).toBe(true);
    const mint = new PublicKey(USDT.solana.address);
    const d = decodeTransferCheckedInstruction(tx.instructions.at(-1)!);
    expect(d.keys.destination.pubkey.toBase58()).toBe(getAssociatedTokenAddressSync(mint, new PublicKey(other.solana.address)).toBase58());
    expect(d.keys.mint.pubkey.toBase58()).toBe(mint.toBase58());
    expect(d.data.amount).toBe(7_000_000n);
    expect(d.data.decimals).toBe(6);
    expect(tx.instructions).toHaveLength(4); // 2× compute budget + create ATA + transfer
  });

  it('rejects off-curve (program/PDA) recipients and wrong keys', async () => {
    const pda = getAssociatedTokenAddressSync(new PublicKey(USDT.solana.address), new PublicKey(other.solana.address));
    expect(a.validateAddress(pda.toBase58())).toBe(false);
    expect(a.validateAddress(other.solana.address)).toBe(true);
    const req = { chain: 'solana' as const, asset: 'native' as const, from: me.solana.address, to: other.solana.address, amount: 1n };
    await expect(a.signWithBlockhash({ request: req, fee: { amount: 0n, symbol: 'SOL' }, payload: { createsRecipientAccount: false } },
      derivePrivateKey(generateMnemonic(), 'solana'), blockhash, 1)).rejects.toMatchObject({ code: 'verification_failed' });
  });
});

describe('EVM adapter without USDT (testnets)', () => {
  it('reports native balance only and refuses USDT transfers', async () => {
    const a = new EvmAdapter({ chain: 'ethereum', chainIdOverride: 11155111, usdtAddress: null, transport: evmMock({ native: 5n, usdt: 0n }) });
    const b = await a.getBalances(me.evm.address);
    expect(b.native).toBe(5n);
    expect(b.usdt).toBeUndefined();
    await expect(a.prepareTransfer({ chain: 'ethereum', asset: 'usdt', from: me.evm.address, to: other.evm.address, amount: 1n }))
      .rejects.toMatchObject({ code: 'unsupported' });
  });
});
