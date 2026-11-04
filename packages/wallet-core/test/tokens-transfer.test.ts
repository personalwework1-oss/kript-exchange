/** Transfers of arbitrary tokens (not just USDT) on every chain. */
import { describe, it, expect } from 'vitest';
import {
  custom, decodeFunctionData, encodeFunctionResult, erc20Abi, multicall3Abi, numberToHex, parseTransaction,
  recoverTransactionAddress, type Hex,
} from 'viem';
import { Transaction as SolTx, PublicKey, Keypair } from '@solana/web3.js';
import { decodeTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { TronWeb, utils as tronUtils } from 'tronweb';
import {
  deriveAccounts, derivePrivateKey, EvmAdapter, findToken, generateMnemonic, SolanaAdapter, TransferError, TronAdapter,
  verifyTronTransfer, type TransferRequest,
} from '../src/index.js';

const m = generateMnemonic();
const me = deriveAccounts(m);
const other = deriveAccounts(generateMnemonic());
const DAI = findToken('ethereum', '0x6B175474E89094C44Da98b954EedeAC495271d0F')!;

function evmRpc(tokenBal: bigint) {
  return custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case 'eth_getBalance': return numberToHex(10n ** 18n);
        case 'eth_call': {
          const call = (params as Array<{ to: string; data: Hex }>)[0]!;
          if (call.to.toLowerCase() === '0xca11bde05977b3631167028862be2a173976ca11') {
            const { args } = decodeFunctionData({ abi: multicall3Abi, data: call.data });
            const calls = args[0] as Array<{ callData: Hex }>;
            return encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: calls.map((c) => {
              const f = decodeFunctionData({ abi: erc20Abi, data: c.callData }).functionName;
              const r = f === 'balanceOf' ? encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: tokenBal })
                : f === 'decimals' ? encodeFunctionResult({ abi: erc20Abi, functionName: 'decimals', result: 18 })
                : encodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', result: 'DAI' });
              return { success: true, returnData: r };
            }) });
          }
          return numberToHex(0n, { size: 32 });
        }
        case 'eth_getTransactionCount': return '0x1';
        case 'eth_estimateGas': return numberToHex(60_000n);
        case 'eth_maxPriorityFeePerGas': return numberToHex(10n ** 9n);
        case 'eth_getBlockByNumber': return { baseFeePerGas: numberToHex(10n ** 10n), number: '0x1', hash: '0x' + '11'.repeat(32), timestamp: '0x1', transactions: [] };
        case 'eth_chainId': return '0x1';
        default: throw new Error(`unexpected ${method}`);
      }
    },
  });
}

describe('any ERC20', () => {
  const key = derivePrivateKey(m, 'evm');
  it('sends DAI to the right recipient through the DAI contract', async () => {
    const a = new EvmAdapter({ chain: 'ethereum', transport: evmRpc(5n * 10n ** 18n) });
    const req: TransferRequest = { chain: 'ethereum', asset: 'token', token: { address: DAI.address, decimals: 18, symbol: 'DAI' }, from: me.evm.address, to: other.evm.address, amount: 10n ** 18n };
    const s = await a.signTransfer(await a.prepareTransfer(req), key);
    const tx = parseTransaction(s.raw as Hex);
    expect(tx.to?.toLowerCase()).toBe(DAI.address.toLowerCase());
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data! }).args).toEqual([other.evm.address, 10n ** 18n]);
    expect(await recoverTransactionAddress({ serializedTransaction: s.raw as never })).toBe(me.evm.address);
  });
  it('reads token balances and metadata via Multicall3', async () => {
    const a = new EvmAdapter({ chain: 'ethereum', transport: evmRpc(7n) });
    expect(await a.getTokenBalances(me.evm.address, [DAI.address])).toEqual({ [DAI.address]: 7n });
    expect(await a.tokenMetadata(DAI.address)).toMatchObject({ decimals: 18, symbol: 'DAI' });
  });
  it('refuses when the token balance is too low or the recipient is the token contract', async () => {
    const a = new EvmAdapter({ chain: 'ethereum', transport: evmRpc(1n) });
    const base: TransferRequest = { chain: 'ethereum', asset: 'token', token: { address: DAI.address, decimals: 18, symbol: 'DAI' }, from: me.evm.address, to: other.evm.address, amount: 10n };
    await expect(a.prepareTransfer(base)).rejects.toMatchObject({ code: 'insufficient_funds' });
    await expect(a.prepareTransfer({ ...base, to: DAI.address })).rejects.toBeInstanceOf(TransferError);
  });
});

describe('any TRC20', () => {
  const JST = 'TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9';
  function tx(contract: string, to: string, amount: bigint) {
    const raw_data = {
      contract: [{ parameter: { value: {
        data: 'a9059cbb' + '0'.repeat(24) + TronWeb.address.toHex(to).slice(2) + amount.toString(16).padStart(64, '0'),
        owner_address: TronWeb.address.toHex(me.tron.address), contract_address: TronWeb.address.toHex(contract),
      }, type_url: 'type.googleapis.com/protocol.TriggerSmartContract' }, type: 'TriggerSmartContract' }],
      ref_block_bytes: 'abcd', ref_block_hash: '0123456789abcdef', expiration: 1_900_000_060_000, fee_limit: 50_000_000, timestamp: 1_900_000_000_000,
    };
    const pb = tronUtils.transaction.txJsonToPb({ raw_data });
    return { raw_data, raw_data_hex: tronUtils.transaction.txPbToRawDataHex(pb), txID: tronUtils.transaction.txPbToTxID(pb).replace(/^0x/, '') };
  }
  const req: TransferRequest = { chain: 'tron', asset: 'token', token: { address: JST, decimals: 18, symbol: 'JST' }, from: me.tron.address, to: other.tron.address, amount: 5n * 10n ** 18n };
  it('verifies a JST transfer and rejects one through another contract', () => {
    expect(() => verifyTronTransfer(tx(JST, other.tron.address, req.amount) as never, req, JST)).not.toThrow();
    expect(() => verifyTronTransfer(tx('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', other.tron.address, req.amount) as never, req, JST)).toThrow(TransferError);
  });
  it('discovers TRC20 holdings from TronGrid', async () => {
    const f = (async (url: string) => {
      expect(String(url)).toBe(`https://api.trongrid.io/v1/accounts/${me.tron.address}`);
      return new Response(JSON.stringify({ data: [{ trc20: [{ [JST]: '1000' }, { TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: '0' }, { notAnAddress: '5' }] }] }));
    }) as unknown as typeof fetch;
    const a = new TronAdapter({ fullHost: 'https://api.trongrid.io', fetch: f, tronWeb: new TronWeb({ fullHost: 'http://127.0.0.1:1' }) });
    expect(await a.discoverTokens(me.tron.address)).toEqual([{ address: JST, amount: 1000n }]);
  });
});

describe('any SPL token incl. Token-2022', () => {
  it('builds a transferChecked through the Token-2022 program with the mint decimals', async () => {
    const a = new SolanaAdapter({ rpcUrl: 'http://127.0.0.1:1' });
    const mint = Keypair.generate().publicKey.toBase58();
    const req: TransferRequest = { chain: 'solana', asset: 'token', token: { address: mint, decimals: 9, symbol: 'X' }, from: me.solana.address, to: other.solana.address, amount: 42n };
    const s = await a.signWithBlockhash({ request: req, fee: { amount: 0n, symbol: 'SOL' }, payload: { createsRecipientAccount: true, tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58() } },
      derivePrivateKey(m, 'solana'), Keypair.generate().publicKey.toBase58(), 1);
    const t = SolTx.from(Buffer.from(s.raw, 'base64'));
    expect(t.verifySignatures()).toBe(true);
    const ix = t.instructions.at(-1)!;
    expect(ix.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    const d = decodeTransferCheckedInstruction(ix, TOKEN_2022_PROGRAM_ID);
    expect(d.data.amount).toBe(42n);
    expect(d.data.decimals).toBe(9);
    expect(d.keys.destination.pubkey.toBase58()).toBe(getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(other.solana.address), false, TOKEN_2022_PROGRAM_ID).toBase58());
  });
});
