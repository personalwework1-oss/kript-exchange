import { describe, it, expect } from 'vitest';
import {
  custom, decodeFunctionData, erc20Abi, hashDomain, keccak256, numberToHex, parseTransaction,
  recoverTypedDataAddress, toBytes, type Hex,
} from 'viem';
import {
  CANCELLATION_TYPES, COW_NATIVE, COW_ORDER_TYPE_HASH, COW_VAULT_RELAYER, computeOrderUid, CowLimitOrders,
  deriveAccounts, derivePrivateKey, domainFor, generateMnemonic, LimitOrderError, ORDER_TYPES, stringifyDeterministic, USDT,
} from '../src/index.js';

const m = generateMnemonic();
const me = deriveAccounts(m);
const key = derivePrivateKey(m, 'evm');
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const usdt = { address: USDT.ethereum.address, symbol: 'USDT', decimals: 6 };
const eth = { address: COW_NATIVE, symbol: 'ETH', decimals: 18 };

describe('CoW protocol constants', () => {
  it('Order type hash matches CoW (sdk-contracts-ts ORDER_TYPE_HASH)', () => {
    const t = 'Order(' + ORDER_TYPES.Order.map((f) => `${f.type} ${f.name}`).join(',') + ')';
    expect(keccak256(toBytes(t))).toBe(COW_ORDER_TYPE_HASH);
  });
  it('mainnet domain separator matches the deployed GPv2Settlement', () => {
    const d = hashDomain({ domain: domainFor(1), types: { EIP712Domain: [
      { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] } });
    expect(d).toBe('0xc078f884a2676e1345748b1feace7b0abee5d00ecadb6e574dcdd109a63e8943');
  });
  it('appData is deterministic (sorted keys, no spaces)', () => {
    expect(stringifyDeterministic({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}');
  });
});

function rpc(state: { native: bigint; token: bigint; allowance: bigint }, sent: Hex[] = []) {
  return custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case 'eth_getBalance': return numberToHex(state.native);
        case 'eth_call': {
          const data = ((params as Array<{ data: Hex }>)[0]!).data;
          if (data.startsWith('0x70a08231')) return numberToHex(state.token, { size: 32 });
          if (data.startsWith('0xdd62ed3e')) return numberToHex(state.allowance, { size: 32 });
          throw new Error('unexpected call');
        }
        case 'eth_getTransactionCount': return '0x0';
        case 'eth_gasPrice': return numberToHex(10_000_000_000n);
        case 'eth_estimateGas': return numberToHex(50_000n);
        case 'eth_sendRawTransaction': { const raw = (params as Hex[])[0]!; sent.push(raw); return keccak256(raw); }
        case 'eth_getTransactionReceipt': return { status: '0x1', blockNumber: '0x5', blockHash: '0x' + '33'.repeat(32), transactionHash: keccak256(sent.at(-1)!), transactionIndex: '0x0', from: me.evm.address, to: WETH, cumulativeGasUsed: '0x1', gasUsed: '0x1', effectiveGasPrice: '0x1', logs: [], logsBloom: '0x' + '00'.repeat(256), contractAddress: null, type: '0x0' };
        case 'eth_blockNumber': return '0x5';
        case 'eth_getBlockByNumber': return { number: '0x5', hash: '0x' + '33'.repeat(32), timestamp: '0x1', transactions: [] };
        case 'eth_chainId': return '0x1';
        default: throw new Error(`unexpected ${method}`);
      }
    },
  });
}

describe('CoW limit orders', () => {
  it('buy ETH with USDT: approves allowance + amount, signs a valid order, uid matches', async () => {
    const sent: Hex[] = [];
    let posted: Record<string, unknown> | null = null;
    const fetchMock = (async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.cow.fi/mainnet/api/v1/orders');
      posted = JSON.parse(String(init!.body));
      const p = posted!;
      const uid = computeOrderUid(1, {
        sellToken: p.sellToken as Hex, buyToken: p.buyToken as Hex, receiver: p.receiver as Hex,
        sellAmount: BigInt(p.sellAmount as string), buyAmount: BigInt(p.buyAmount as string), validTo: p.validTo as number,
        appData: p.appDataHash as Hex, feeAmount: 0n, kind: 'sell', partiallyFillable: false, sellTokenBalance: 'erc20', buyTokenBalance: 'erc20',
      }, me.evm.address);
      return new Response(JSON.stringify(uid), { status: 201 });
    }) as unknown as typeof fetch;

    const cow = new CowLimitOrders({ rpc: { ethereum: rpc({ native: 10n ** 17n, token: 500_000_000n, allowance: 5_000_000n }, sent) }, fetch: fetchMock,
      partnerFee: { recipient: '0x1111111111111111111111111111111111111111', bps: 20 } });
    const p = await cow.prepare({ chain: 'ethereum', owner: me.evm.address, sell: usdt, buy: eth, sellAmount: 100_000_000n, buyAmount: 40_000_000_000_000_000n, validForSec: 7 * 86400 });
    expect(p.wrapAmount).toBe(0n);
    expect(p.approveTo).toBe(105_000_000n); // existing 5 USDT + 100 USDT
    expect(p.order.receiver).toBe(me.evm.address);
    expect(JSON.parse(p.appData).metadata.partnerFee).toEqual({ volumeBps: 20, recipient: '0x1111111111111111111111111111111111111111' });

    const res = await cow.place(p, key);
    expect(sent).toHaveLength(2); // reset to 0 (USDT rule), then approve
    expect(decodeFunctionData({ abi: erc20Abi, data: parseTransaction(sent[0]!).data! }).args).toEqual([COW_VAULT_RELAYER, 0n]);
    const approve = parseTransaction(sent[1]!);
    expect(approve.to?.toLowerCase()).toBe(USDT.ethereum.address.toLowerCase());
    expect(decodeFunctionData({ abi: erc20Abi, data: approve.data! }).args).toEqual([COW_VAULT_RELAYER, 105_000_000n]);

    const body = posted! as Record<string, string>;
    expect(body.buyToken).toBe(COW_NATIVE);
    expect(body.feeAmount).toBe('0');
    expect(body.appDataHash).toBe(keccak256(toBytes(body.appData!)));
    const signer = await recoverTypedDataAddress({ domain: domainFor(1), types: ORDER_TYPES, primaryType: 'Order', message: p.order, signature: body.signature as Hex });
    expect(signer).toBe(me.evm.address);
    expect(res.uid.length).toBe(2 + 56 * 2);
  });

  it('sell ETH: wraps only the missing part into WETH first, sells WETH', async () => {
    const sent: Hex[] = [];
    const fetchMock = (async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init!.body));
      return new Response(JSON.stringify(computeOrderUid(1, { ...b, sellAmount: BigInt(b.sellAmount), buyAmount: BigInt(b.buyAmount), appData: b.appDataHash, feeAmount: 0n }, me.evm.address)));
    }) as unknown as typeof fetch;
    const cow = new CowLimitOrders({ rpc: { ethereum: rpc({ native: 10n ** 18n, token: 10n ** 16n, allowance: 0n }, sent) }, fetch: fetchMock });
    const p = await cow.prepare({ chain: 'ethereum', owner: me.evm.address, sell: eth, buy: usdt, sellAmount: 5n * 10n ** 16n, buyAmount: 200_000_000n, validForSec: 86400 });
    expect(p.order.sellToken).toBe(WETH);
    expect(p.wrapAmount).toBe(4n * 10n ** 16n);
    await cow.place(p, key);
    expect(sent).toHaveLength(2);
    const wrap = parseTransaction(sent[0]!);
    expect(wrap.to).toBe(WETH.toLowerCase());
    expect(wrap.value).toBe(4n * 10n ** 16n);
    expect(wrap.data).toBe('0xd0e30db0'); // deposit()
  });

  it('refuses: not enough balance, order id mismatch, wrong key, unsupported chain in testnet', async () => {
    const poor = new CowLimitOrders({ rpc: { ethereum: rpc({ native: 0n, token: 1n, allowance: 0n }) } });
    await expect(poor.prepare({ chain: 'ethereum', owner: me.evm.address, sell: usdt, buy: eth, sellAmount: 10n, buyAmount: 1n, validForSec: 3600 }))
      .rejects.toMatchObject({ code: 'insufficient_funds' });

    const liar = (async () => new Response(JSON.stringify('0x' + 'ab'.repeat(56)))) as unknown as typeof fetch;
    const cow = new CowLimitOrders({ rpc: { ethereum: rpc({ native: 10n ** 18n, token: 10n ** 9n, allowance: 10n ** 9n }) }, fetch: liar });
    const p = await cow.prepare({ chain: 'ethereum', owner: me.evm.address, sell: usdt, buy: eth, sellAmount: 10n, buyAmount: 1n, validForSec: 3600 });
    expect(p.approveTo).toBeNull();
    await expect(cow.place(p, key)).rejects.toMatchObject({ code: 'mismatch' });
    await expect(cow.place(p, derivePrivateKey(generateMnemonic(), 'evm'))).rejects.toMatchObject({ code: 'mismatch' });

    const test = new CowLimitOrders({ rpc: { ethereum: 'http://x', bsc: 'http://x' }, testnet: true });
    expect(test.supports('ethereum')).toBe(true);
    expect(test.supports('bsc')).toBe(false);
  });

  it('cancels with an EIP-712 signature from the owner', async () => {
    let body: { orderUids: Hex[]; signature: Hex } | null = null;
    const f = (async (_u: string, init?: RequestInit) => { body = JSON.parse(String(init!.body)); expect(init!.method).toBe('DELETE'); return new Response('"Cancelled"'); }) as unknown as typeof fetch;
    const cow = new CowLimitOrders({ rpc: { ethereum: 'http://x' }, fetch: f });
    const uid = ('0x' + 'cd'.repeat(32) + me.evm.address.slice(2).toLowerCase() + '00ffffff') as Hex;
    await cow.cancel('ethereum', uid, key);
    const signer = await recoverTypedDataAddress({ domain: domainFor(1), types: CANCELLATION_TYPES, primaryType: 'OrderCancellations', message: { orderUids: [uid] }, signature: body!.signature });
    expect(signer).toBe(me.evm.address);
    const notMine = ('0x' + 'cd'.repeat(32) + '22'.repeat(20) + '00ffffff') as Hex;
    await expect(cow.cancel('ethereum', notMine, key)).rejects.toBeInstanceOf(LimitOrderError);
  });

  it('lists orders and maps statuses', async () => {
    const f = (async () => new Response(JSON.stringify([
      { uid: '0x1', sellToken: usdt.address, buyToken: COW_NATIVE, sellAmount: '100', buyAmount: '1', executedSellAmount: '100', executedBuyAmount: '2', validTo: 1, creationDate: '2026-11-02', status: 'fulfilled' },
      { uid: '0x2', sellToken: usdt.address, buyToken: COW_NATIVE, sellAmount: '50', buyAmount: '1', validTo: 2, status: 'open' },
    ]))) as unknown as typeof fetch;
    const cow = new CowLimitOrders({ rpc: { polygon: 'http://x' }, fetch: f });
    const list = await cow.list('polygon', me.evm.address);
    expect(list.map((o) => o.status)).toEqual(['filled', 'open']);
    expect(list[0]!.executedBuy).toBe(2n);
  });
});
