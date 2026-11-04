import { describe, it, expect } from 'vitest';
import {
  custom, decodeFunctionData, encodeFunctionData, erc20Abi, keccak256, numberToHex, parseTransaction,
  recoverTransactionAddress, type Hex,
} from 'viem';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  deriveAccounts, derivePrivateKey, EVM_NATIVE, generateMnemonic, JupiterProvider, SOL_MINT, SwapError, USDT,
  validateZeroExQuote, ZeroExProvider, type SwapRequest,
} from '../src/index.js';

const m = generateMnemonic();
const me = deriveAccounts(m);
const ALLOWANCE_HOLDER = '0x0000000000001fF3684f28c67538d4D072C22734';
const SETTLER = '0x1111111111111111111111111111111111111111';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const execAbi = [{ type: 'function', name: 'exec', stateMutability: 'payable', inputs: [
  { name: 'operator', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' },
  { name: 'target', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [{ name: 'result', type: 'bytes' }] }] as const;

const sellUsdt: SwapRequest = {
  chain: 'ethereum',
  sell: { address: USDT.ethereum.address, symbol: 'USDT', decimals: 6 },
  buy: { address: WETH, symbol: 'WETH', decimals: 18 },
  sellAmount: 100_000_000n, // 100 USDT
  taker: me.evm.address,
  slippageBps: 50,
};

function zxQuote(over: Record<string, unknown> = {}, execOver: Partial<{ token: string; amount: bigint }> = {}) {
  const data = encodeFunctionData({ abi: execAbi, functionName: 'exec', args: [
    SETTLER, (execOver.token ?? sellUsdt.sell.address) as Hex, execOver.amount ?? sellUsdt.sellAmount, SETTLER, '0xdeadbeef'] });
  return {
    liquidityAvailable: true,
    sellToken: sellUsdt.sell.address.toLowerCase(), buyToken: WETH.toLowerCase(),
    sellAmount: '100000000', buyAmount: '40000000000000000', minBuyAmount: '39800000000000000',
    transaction: { to: ALLOWANCE_HOLDER, data, gas: '200000', gasPrice: '20000000000', value: '0' },
    issues: { allowance: { actual: '0', spender: ALLOWANCE_HOLDER }, balance: null },
    fees: { integratorFee: { amount: '300000', token: sellUsdt.sell.address } },
    route: { fills: [{ source: 'Uniswap_V3', proportionBps: '10000' }] },
    totalNetworkFee: '4000000000000000',
    ...over,
  };
}

describe('0x quote validation', () => {
  it('accepts an honest quote', () => {
    const p = validateZeroExQuote(zxQuote() as never, sellUsdt, 1, 50);
    expect(p.tx.to).toBe(ALLOWANCE_HOLDER);
    expect(p.spender).toBe(ALLOWANCE_HOLDER);
  });

  const bad: Array<[string, Record<string, unknown>, Partial<{ token: string; amount: bigint }>?]> = [
    ['spender differs from target', { issues: { allowance: { actual: '0', spender: '0x2222222222222222222222222222222222222222' }, balance: null } }],
    ['exec sells another token', {}, { token: '0x6B175474E89094C44Da98b954EedeAC495271d0F' }],
    ['exec sells more', {}, { amount: 100_000_001n }],
    ['min below slippage', { minBuyAmount: '39000000000000000' }],
    ['other buy token', { buyToken: '0x6b175474e89094c44da98b954eedeac495271d0f' }],
    ['sends ETH while selling USDT', { transaction: { ...zxQuote().transaction, value: '1' } }],
    ['calldata is not exec', { transaction: { ...zxQuote().transaction, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [SETTLER, 1n] }) } }],
  ];
  for (const [name, over, execOver] of bad) {
    it(`rejects: ${name}`, () => {
      expect(() => validateZeroExQuote(zxQuote(over, execOver) as never, sellUsdt, 1, 50)).toThrow(SwapError);
    });
  }

  it('native sell must carry exactly the sell amount as value', () => {
    const req = { ...sellUsdt, sell: { address: EVM_NATIVE, symbol: 'ETH', decimals: 18 }, buy: { address: USDT.ethereum.address, symbol: 'USDT', decimals: 6 }, sellAmount: 10n ** 16n };
    const q = (value: string) => zxQuote({
      sellToken: EVM_NATIVE.toLowerCase(), buyToken: USDT.ethereum.address.toLowerCase(), sellAmount: String(10n ** 16n),
      buyAmount: '40000000', minBuyAmount: '39800000', issues: { allowance: null, balance: null },
      transaction: { ...zxQuote().transaction, value },
    }, { token: EVM_NATIVE, amount: 10n ** 16n });
    expect(() => validateZeroExQuote(q(String(10n ** 16n)) as never, req, 1, 50)).not.toThrow();
    expect(() => validateZeroExQuote(q(String(10n ** 17n)) as never, req, 1, 50)).toThrow(SwapError);
  });
});

describe('0x execute', () => {
  it('approves exactly the sell amount to AllowanceHolder, then swaps — both signed by us', async () => {
    const sent: Hex[] = [];
    const transport = custom({
      async request({ method, params }: { method: string; params?: unknown[] }) {
        switch (method) {
          case 'eth_getTransactionCount': return '0x3';
          case 'eth_gasPrice': return numberToHex(15_000_000_000n);
          case 'eth_estimateGas': return numberToHex(60_000n);
          case 'eth_sendRawTransaction': { const raw = (params as Hex[])[0]!; sent.push(raw); return keccak256(raw); }
          case 'eth_blockNumber': return '0x10';
          case 'eth_getTransactionReceipt': return { status: '0x1', blockNumber: '0x10', blockHash: '0x' + '22'.repeat(32), transactionHash: keccak256(sent[0]!), transactionIndex: '0x0', from: me.evm.address, to: USDT.ethereum.address, cumulativeGasUsed: '0x1', gasUsed: '0x1', effectiveGasPrice: '0x1', logs: [], logsBloom: '0x' + '00'.repeat(256), contractAddress: null, type: '0x0' };
          case 'eth_getBlockByNumber': return { number: '0x10', hash: '0x' + '22'.repeat(32), timestamp: '0x1', transactions: [] };
          case 'eth_chainId': return '0x1';
          default: throw new Error(`unexpected ${method}`);
        }
      },
    });
    const fetchMock = (async () => new Response(JSON.stringify(zxQuote()))) as unknown as typeof fetch;
    const zx = new ZeroExProvider({ apiKey: 'k', fetch: fetchMock, rpc: { ethereum: transport } });
    const q = await zx.quote(sellUsdt);
    expect(q.needsApproval).toBe(true);
    expect(q.minBuyAmount).toBe(39_800_000_000_000_000n);
    const key = derivePrivateKey(m, 'evm');
    const res = await zx.execute(q, key);
    expect(sent).toHaveLength(2);

    const approve = parseTransaction(sent[0]!);
    expect(approve.to?.toLowerCase()).toBe(USDT.ethereum.address.toLowerCase());
    const a = decodeFunctionData({ abi: erc20Abi, data: approve.data! });
    expect(a.functionName).toBe('approve');
    expect(a.args).toEqual([ALLOWANCE_HOLDER, 100_000_000n]); // exact, never unlimited
    expect(approve.nonce).toBe(3);

    const swap = parseTransaction(sent[1]!);
    expect(swap.to?.toLowerCase()).toBe(ALLOWANCE_HOLDER.toLowerCase());
    expect(swap.nonce).toBe(4);
    expect(swap.chainId).toBe(1);
    for (const raw of sent) expect(await recoverTransactionAddress({ serializedTransaction: raw as never })).toBe(me.evm.address);
    expect(res.txid).toBe(keccak256(sent[1]!));
  });

  it('resets a non-zero USDT allowance to 0 before approving (USDT refuses non-zero -> non-zero)', async () => {
    const sent: Hex[] = [];
    const transport = custom({
      async request({ method, params }: { method: string; params?: unknown[] }) {
        switch (method) {
          case 'eth_getTransactionCount': return '0x0';
          case 'eth_gasPrice': return numberToHex(15_000_000_000n);
          case 'eth_estimateGas': return numberToHex(60_000n);
          case 'eth_sendRawTransaction': { const raw = (params as Hex[])[0]!; sent.push(raw); return keccak256(raw); }
          case 'eth_blockNumber': return '0x10';
          case 'eth_getTransactionReceipt': return { status: '0x1', blockNumber: '0x10', blockHash: '0x' + '22'.repeat(32), transactionHash: keccak256(sent.at(-1)!), transactionIndex: '0x0', from: me.evm.address, to: USDT.ethereum.address, cumulativeGasUsed: '0x1', gasUsed: '0x1', effectiveGasPrice: '0x1', logs: [], logsBloom: '0x' + '00'.repeat(256), contractAddress: null, type: '0x0' };
          case 'eth_getBlockByNumber': return { number: '0x10', hash: '0x' + '22'.repeat(32), timestamp: '0x1', transactions: [] };
          case 'eth_chainId': return '0x1';
          default: throw new Error(`unexpected ${method}`);
        }
      },
    });
    const q0 = zxQuote({ issues: { allowance: { actual: '5000000', spender: ALLOWANCE_HOLDER }, balance: null } });
    const zx = new ZeroExProvider({ apiKey: 'k', fetch: (async () => new Response(JSON.stringify(q0))) as unknown as typeof fetch, rpc: { ethereum: transport } });
    const q = await zx.quote(sellUsdt);
    await zx.execute(q, derivePrivateKey(m, 'evm'));
    expect(sent).toHaveLength(3);
    expect(decodeFunctionData({ abi: erc20Abi, data: parseTransaction(sent[0]!).data! }).args).toEqual([ALLOWANCE_HOLDER, 0n]);
    expect(decodeFunctionData({ abi: erc20Abi, data: parseTransaction(sent[1]!).data! }).args).toEqual([ALLOWANCE_HOLDER, 100_000_000n]);
    expect(parseTransaction(sent[2]!).to?.toLowerCase()).toBe(ALLOWANCE_HOLDER.toLowerCase());
  });

  it('refuses an expired quote', async () => {
    const fetchMock = (async () => new Response(JSON.stringify(zxQuote()))) as unknown as typeof fetch;
    const zx = new ZeroExProvider({ apiKey: 'k', fetch: fetchMock, rpc: { ethereum: 'http://127.0.0.1:1' } });
    const q = await zx.quote(sellUsdt);
    await expect(zx.execute({ ...q, expiresAt: Date.now() - 1 }, derivePrivateKey(m, 'evm'))).rejects.toMatchObject({ code: 'expired' });
  });

  it('passes integrator fee params to the API', async () => {
    let url = '';
    const fetchMock = (async (u: string) => { url = String(u); return new Response(JSON.stringify(zxQuote())); }) as unknown as typeof fetch;
    const zx = new ZeroExProvider({ apiKey: 'k', fetch: fetchMock, rpc: { ethereum: 'http://127.0.0.1:1' }, fee: { recipient: SETTLER, bps: 30 } });
    await zx.quote(sellUsdt);
    const p = new URL(url).searchParams;
    expect(p.get('swapFeeBps')).toBe('30');
    expect(p.get('swapFeeRecipient')).toBe(SETTLER);
    expect(p.get('taker')).toBe(me.evm.address);
  });
});

// ─────────────────────────── Jupiter ───────────────────────────
describe('Jupiter', () => {
  const taker = me.solana.address;
  const takerPk = new PublicKey(taker);
  const usdtMint = new PublicKey(USDT.solana.address);
  const takerUsdt = getAssociatedTokenAddressSync(usdtMint, takerPk, true);
  const req: SwapRequest = {
    chain: 'solana',
    sell: { address: SOL_MINT, symbol: 'SOL', decimals: 9 },
    buy: { address: USDT.solana.address, symbol: 'USDT', decimals: 6 },
    sellAmount: 1_000_000_000n, // 1 SOL
    taker,
    slippageBps: 50,
  };

  function buildTx(signer = takerPk) {
    const msg = new TransactionMessage({
      payerKey: signer,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: signer, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
    }).compileToV0Message();
    return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
  }

  const order = (over: Record<string, unknown> = {}) => ({
    inputMint: SOL_MINT, outputMint: USDT.solana.address, inAmount: '1000000000', outAmount: '150000000',
    otherAmountThreshold: '149250000', slippageBps: 50, router: 'metis', routePlan: [{ swapInfo: { label: 'Raydium CLMM' } }],
    transaction: buildTx(), requestId: 'req-1', signatureFeePayer: taker, signatureFeeLamports: 5000, prioritizationFeeLamports: 10000,
    ...over,
  });

  function tokenAcc(amount: bigint) {
    const b = Buffer.alloc(165);
    b.writeBigUInt64LE(amount, 64);
    return b;
  }

  /** Fake RPC: balances before, and a simulation result after. */
  function conn(sim: { solAfter: bigint; usdtAfter: bigint; err?: unknown }) {
    return {
      getBalance: async () => 5_000_000_000,
      getAccountInfo: async (pk: PublicKey) => (pk.equals(takerUsdt) ? { data: tokenAcc(10_000_000n) } : null),
      simulateTransaction: async () => ({
        value: {
          err: sim.err ?? null,
          accounts: [
            { lamports: Number(sim.solAfter), data: ['', 'base64'] },
            { lamports: 2039280, data: [tokenAcc(sim.usdtAfter).toString('base64'), 'base64'] },
          ],
        },
      }),
    } as never;
  }

  const honest = { solAfter: 5_000_000_000n - 1_000_000_000n - 20_000n, usdtAfter: 10_000_000n + 150_000_000n };
  const fetchOrder = (o: unknown) => (async () => new Response(JSON.stringify(o))) as unknown as typeof fetch;

  it('accepts an order whose simulation pays what was promised', async () => {
    const j = new JupiterProvider({ connection: conn(honest), fetch: fetchOrder(order()) });
    const q = await j.quote(req);
    expect(q.buyAmount).toBe(150_000_000n);
    expect(q.minBuyAmount).toBe(149_250_000n);
    expect(q.route).toBe('Raydium CLMM');
  });

  const cases: Array<[string, Parameters<typeof conn>[0]]> = [
    ['spends more SOL than asked', { ...honest, solAfter: 5_000_000_000n - 1_100_000_000n }],
    ['delivers less than the minimum', { ...honest, usdtAfter: 10_000_000n + 100_000_000n }],
    ['simulation fails', { ...honest, err: { InstructionError: [0, 'Custom'] } }],
  ];
  for (const [name, sim] of cases) {
    it(`rejects: ${name}`, async () => {
      const j = new JupiterProvider({ connection: conn(sim), fetch: fetchOrder(order()) });
      await expect(j.quote(req)).rejects.toMatchObject({ code: 'unsafe_quote' });
    });
  }

  it('rejects: wallet is not a signer / unexpected fee payer / wrong amount', async () => {
    const stranger = Keypair.generate().publicKey;
    for (const o of [order({ transaction: buildTx(stranger) }), order({ inAmount: '999' })]) {
      const j = new JupiterProvider({ connection: conn(honest), fetch: fetchOrder(o) });
      await expect(j.quote(req)).rejects.toBeInstanceOf(SwapError);
    }
  });

  it('maps "insufficient funds" error code', async () => {
    const j = new JupiterProvider({ connection: conn(honest), fetch: fetchOrder(order({ transaction: '', errorCode: 1 })) });
    await expect(j.quote(req)).rejects.toMatchObject({ code: 'insufficient_funds' });
  });

  it('execute signs with the wallet key and posts to /execute', async () => {
    let posted: { signedTransaction: string; requestId: string } | null = null;
    const o = order();
    const f = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/execute')) {
        posted = JSON.parse(String(init!.body));
        return new Response(JSON.stringify({ status: 'Success', signature: 'SIG' }));
      }
      return new Response(JSON.stringify(o));
    }) as unknown as typeof fetch;
    const j = new JupiterProvider({ connection: conn(honest), fetch: f });
    const q = await j.quote(req);
    const res = await j.execute(q, derivePrivateKey(m, 'solana'));
    expect(res.txid).toBe('SIG');
    expect(posted!.requestId).toBe('req-1');
    const signed = VersionedTransaction.deserialize(Buffer.from(posted!.signedTransaction, 'base64'));
    expect(ed25519.verify(signed.signatures[0]!, signed.message.serialize(), takerPk.toBytes())).toBe(true);
  });
});
