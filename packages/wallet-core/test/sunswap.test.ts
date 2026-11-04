import { describe, it, expect } from 'vitest';
import { TronWeb, utils as tronUtils } from 'tronweb';
import { decodeAbiParameters, encodeAbiParameters, toFunctionSelector, type Hex } from 'viem';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hex } from '@scure/base';
import {
  deriveAccounts, derivePrivateKey, generateMnemonic, SUNSWAP_V2_FACTORY, SUNSWAP_V2_ROUTER, SunSwapProvider,
  SwapError, tronAddressFromPublicKey, TRX_NATIVE, USDT, WTRX, type SwapRequest,
} from '../src/index.js';

const m = generateMnemonic();
const me = deriveAccounts(m).tron.address;
const key = derivePrivateKey(m, 'tron');
const evm = (t: string) => `0x${TronWeb.address.toHex(t).slice(2)}` as Hex;
const word = (t: string) => encodeAbiParameters([{ type: 'address' }], [evm(t)]).slice(2);
const offline = new TronWeb({ fullHost: 'http://127.0.0.1:1' });

const sellUsdt: SwapRequest = {
  chain: 'tron', sell: { address: USDT.tron.address, symbol: 'USDT', decimals: 6 }, buy: { address: TRX_NATIVE, symbol: 'TRX', decimals: 6 },
  sellAmount: 50_000_000n, taker: me, slippageBps: 50,
};
const sellTrx: SwapRequest = { ...sellUsdt, sell: sellUsdt.buy, buy: sellUsdt.sell, sellAmount: 100_000_000n };

interface MockOpts {
  factory?: string;
  names?: string[];
  allowance?: bigint;
  usdtBal?: bigint;
  trx?: number;
  tamper?: (data: string) => string;
}

function mockTronWeb(o: MockOpts = {}) {
  const sent: Array<{ txID: string; raw_data: { contract: Array<{ parameter: { value: Record<string, unknown> } }> }; signature: string[] }> = [];
  const names = o.names ?? ['factory', 'WETH', 'getAmountsOut', 'swapExactETHForTokens', 'swapExactTokensForETH', 'swapExactTokensForTokens'];
  const tw = {
    trx: {
      getContract: async () => ({ abi: { entrys: names.map((name) => ({ name, type: 'Function' })) } }),
      getBalance: async () => o.trx ?? 1_000_000_000,
      sign: (tx: unknown, pk: string) => offline.trx.sign(tx as never, pk),
      sendRawTransaction: async (tx: (typeof sent)[number]) => { sent.push(tx); return { result: true }; },
      getTransactionInfo: async (id: string) => ({ id, receipt: { result: 'SUCCESS' } }),
    },
    transactionBuilder: {
      triggerConstantContract: async (_c: string, sig: string, opts: { rawParameter?: string }) => {
        let out = '';
        if (sig === 'factory()') out = word(o.factory ?? SUNSWAP_V2_FACTORY);
        else if (sig === 'WETH()' || sig === 'WTRX()') out = word(WTRX);
        else if (sig.startsWith('getAmountsOut')) {
          const [amountIn] = decodeAbiParameters([{ type: 'uint256' }, { type: 'address[]' }], `0x${opts.rawParameter}`);
          // 1 USDT = 3 TRX, both 6 decimals
          const out1 = sig && decodeAbiParameters([{ type: 'uint256' }, { type: 'address[]' }], `0x${opts.rawParameter}`)[1][0]!.toLowerCase() === evm(USDT.tron.address).toLowerCase() ? amountIn * 3n : amountIn / 3n;
          out = encodeAbiParameters([{ type: 'uint256[]' }], [[amountIn, out1]]).slice(2);
        } else if (sig.startsWith('allowance')) out = encodeAbiParameters([{ type: 'uint256' }], [o.allowance ?? 0n]).slice(2);
        else if (sig.startsWith('balanceOf')) out = encodeAbiParameters([{ type: 'uint256' }], [o.usdtBal ?? 10n ** 12n]).slice(2);
        return { result: { result: true }, constant_result: [out], energy_used: 60000 };
      },
      triggerSmartContract: async (contract: string, sig: string, opts: { rawParameter: string; callValue: number; feeLimit: number }, _p: unknown, owner: string) => {
        let data = toFunctionSelector(sig).slice(2) + opts.rawParameter;
        if (o.tamper) data = o.tamper(data);
        const value: Record<string, unknown> = { data, owner_address: TronWeb.address.toHex(owner), contract_address: TronWeb.address.toHex(contract) };
        if (opts.callValue) value.call_value = opts.callValue;
        const raw_data = {
          contract: [{ parameter: { value, type_url: 'type.googleapis.com/protocol.TriggerSmartContract' }, type: 'TriggerSmartContract' }],
          ref_block_bytes: 'abcd', ref_block_hash: '0123456789abcdef', expiration: 1_900_000_060_000, fee_limit: opts.feeLimit, timestamp: 1_900_000_000_000,
        };
        const pb = tronUtils.transaction.txJsonToPb({ raw_data });
        return { result: { result: true }, transaction: { visible: false, raw_data, raw_data_hex: tronUtils.transaction.txPbToRawDataHex(pb), txID: tronUtils.transaction.txPbToTxID(pb).replace(/^0x/, '') } };
      },
    },
  };
  return { tw: tw as unknown as TronWeb, sent };
}

function signerOf(tx: { txID: string; signature: string[] }) {
  const sig = hex.decode(tx.signature[0]!);
  const rec = sig[64]! >= 27 ? sig[64]! - 27 : sig[64]!;
  const pub = secp256k1.Signature.fromBytes(sig.slice(0, 64), 'compact').addRecoveryBit(rec).recoverPublicKey(hex.decode(tx.txID)).toBytes(false);
  return tronAddressFromPublicKey(pub);
}

const dataOf = (tx: { raw_data: { contract: Array<{ parameter: { value: Record<string, unknown> } }> } }) => String(tx.raw_data.contract[0]!.parameter.value.data);

describe('SunSwap (Tron)', () => {
  it('verifies the router on-chain: wrong factory or foreign ABI is refused', async () => {
    const bad = new SunSwapProvider({ tronWeb: mockTronWeb({ factory: 'TXk8rQSAvPvBBNtqSoY6nCfsXWCSSpTVQF' }).tw });
    await expect(bad.quote(sellUsdt)).rejects.toMatchObject({ code: 'unsafe_quote' });
    const notRouter = new SunSwapProvider({ tronWeb: mockTronWeb({ names: ['transfer', 'balanceOf'] }).tw });
    await expect(notRouter.quote(sellUsdt)).rejects.toMatchObject({ code: 'unsafe_quote' });
  });

  it('USDT -> TRX: resets allowance, approves exact amount to router, swaps with our min-out; all signed by us', async () => {
    const { tw, sent } = mockTronWeb({ allowance: 5_000_000n });
    const s = new SunSwapProvider({ tronWeb: tw });
    const q = await s.quote(sellUsdt);
    expect(q.buyAmount).toBe(150_000_000n);
    expect(q.minBuyAmount).toBe(149_250_000n);
    expect(q.needsApproval).toBe(true);
    const res = await s.execute(q, key);
    expect(sent).toHaveLength(3);
    for (const tx of sent) expect(signerOf(tx)).toBe(me);

    const approveSel = toFunctionSelector('approve(address,uint256)').slice(2);
    expect(dataOf(sent[0]!).startsWith(approveSel)).toBe(true);
    expect(decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], `0x${dataOf(sent[0]!).slice(8)}`)[1]).toBe(0n);
    const [spender, amt] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], `0x${dataOf(sent[1]!).slice(8)}`);
    expect(spender.toLowerCase()).toBe(evm(SUNSWAP_V2_ROUTER).toLowerCase());
    expect(amt).toBe(50_000_000n);

    const swap = sent[2]!;
    expect(String(swap.raw_data.contract[0]!.parameter.value.contract_address).toLowerCase()).toBe(TronWeb.address.toHex(SUNSWAP_V2_ROUTER).toLowerCase());
    expect(dataOf(swap).startsWith(toFunctionSelector('swapExactTokensForETH(uint256,uint256,address[],address,uint256)').slice(2))).toBe(true);
    const [amountIn, minOut, path, to] = decodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }], `0x${dataOf(swap).slice(8)}`);
    expect(amountIn).toBe(50_000_000n);
    expect(minOut).toBe(149_250_000n);
    expect(path.map((p) => p.toLowerCase())).toEqual([evm(USDT.tron.address), evm(WTRX)].map((p) => p.toLowerCase()));
    expect(to.toLowerCase()).toBe(evm(me).toLowerCase());
    expect(res.txid).toBe(swap.txID);
  });

  it('TRX -> USDT: sends exactly the amount as call value, no approval; uses TRX-named functions if the ABI has them', async () => {
    const { tw, sent } = mockTronWeb({ names: ['factory', 'WTRX', 'getAmountsOut', 'swapExactTRXForTokens', 'swapExactTokensForTRX', 'swapExactTokensForTokens'] });
    const s = new SunSwapProvider({ tronWeb: tw });
    const q = await s.quote(sellTrx);
    expect(q.needsApproval).toBe(false);
    await s.execute(q, key);
    expect(sent).toHaveLength(1);
    expect(BigInt(sent[0]!.raw_data.contract[0]!.parameter.value.call_value as number)).toBe(100_000_000n);
    expect(dataOf(sent[0]!).startsWith(toFunctionSelector('swapExactTRXForTokens(uint256,address[],address,uint256)').slice(2))).toBe(true);
  });

  it('token -> token (JST -> USDT): picks the better of direct and via-WTRX routes, uses swapExactTokensForTokens', async () => {
    const JST = 'TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9';
    const { tw, sent } = mockTronWeb();
    const s = new SunSwapProvider({ tronWeb: tw });
    const q = await s.quote({ ...sellUsdt, sell: { address: JST, symbol: 'JST', decimals: 18 }, buy: sellUsdt.sell, sellAmount: 9n });
    await s.execute(q, key);
    const swap = sent.at(-1)!;
    expect(dataOf(swap).startsWith(toFunctionSelector('swapExactTokensForTokens(uint256,uint256,address[],address,uint256)').slice(2))).toBe(true);
    const [, , path] = decodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }], `0x${dataOf(swap).slice(8)}`);
    expect(path[0]!.toLowerCase()).toBe(evm(JST).toLowerCase());
    expect(path.at(-1)!.toLowerCase()).toBe(evm(USDT.tron.address).toLowerCase());
    // approval went to the JST contract
    expect(String(sent[0]!.raw_data.contract[0]!.parameter.value.contract_address).toLowerCase()).toBe(TronWeb.address.toHex(JST).toLowerCase());
  });

  it('refuses a node that alters our call data', async () => {
    const evil = deriveAccounts(generateMnemonic()).tron.address;
    const { tw, sent } = mockTronWeb({ tamper: (d) => d.replace(word(me).slice(24), word(evil).slice(24)) });
    const s = new SunSwapProvider({ tronWeb: tw });
    const q = await s.quote(sellTrx);
    await expect(s.execute(q, key)).rejects.toMatchObject({ code: 'unsafe_quote' });
    expect(sent).toHaveLength(0);
  });

  it('refuses: insufficient USDT, not enough TRX for fees, unsupported pair, wrong key', async () => {
    await expect(new SunSwapProvider({ tronWeb: mockTronWeb({ usdtBal: 1n }).tw }).quote(sellUsdt)).rejects.toMatchObject({ code: 'insufficient_funds' });
    await expect(new SunSwapProvider({ tronWeb: mockTronWeb({ trx: 1_000_000 }).tw }).quote(sellUsdt)).rejects.toMatchObject({ code: 'insufficient_fee' });
    await expect(new SunSwapProvider({ tronWeb: mockTronWeb().tw }).quote({ ...sellUsdt, buy: { address: 'notatronaddress', symbol: 'X', decimals: 6 } }))
      .rejects.toBeInstanceOf(SwapError);
    const s = new SunSwapProvider({ tronWeb: mockTronWeb().tw });
    const q = await s.quote(sellTrx);
    await expect(s.execute(q, derivePrivateKey(generateMnemonic(), 'tron'))).rejects.toMatchObject({ code: 'unsafe_quote' });
  });
});
