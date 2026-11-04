/**
 * Ethereum (ERC20), BNB Smart Chain (BEP20), Polygon — one implementation, three chains.
 */
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  http,
  type PublicClient,
  type Transport,
  type TransactionSerializable,
  type Hex,
  toHex,
  keccak256,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAINS, USDT, type ChainId } from '../chains.js';
import {
  assertPositive,
  tokenOf,
  TransferError,
  type DiscoveredToken,
  type TokenMeta,
  type Balances,
  type NetworkAdapter,
  type PreparedTransfer,
  type SignedTransfer,
  type TransferRequest,
} from './types.js';

type EvmChain = 'ethereum' | 'bsc' | 'polygon';

const EXPLORERS: Record<EvmChain, string> = {
  ethereum: 'https://etherscan.io/tx/',
  bsc: 'https://bscscan.com/tx/',
  polygon: 'https://polygonscan.com/tx/',
};

/** BSC fee market is effectively legacy gasPrice; ETH/Polygon use EIP-1559. */
const LEGACY_GAS: Record<EvmChain, boolean> = { ethereum: false, bsc: true, polygon: false };

/** Safety margin on estimated gas (+20%) */
const GAS_BUFFER_PCT = 120n;

export interface EvmAdapterOptions {
  chain: EvmChain;
  /** RPC URL (Alchemy, QuickNode, own node…) */
  rpcUrl?: string;
  /** Custom transport (tests, fallbacks) */
  transport?: Transport;
  /** Testnets: override EIP-155 chain id (Sepolia 11155111, BSC testnet 97, Polygon Amoy 80002) */
  chainIdOverride?: number;
  /** Testnets: override the USDT/test-token contract address; `null` disables USDT on this chain */
  usdtAddress?: string | null;
  /** Explorer base for testnets, e.g. https://sepolia.etherscan.io/tx/ */
  explorerTxBase?: string;
  /** RPC supports alchemy_getTokenBalances (Alchemy endpoints) — enables token discovery */
  alchemyDiscovery?: boolean;
}

/** Multicall3 — same address on Ethereum, BNB Chain, Polygon and their testnets */
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

interface EvmPayload {
  tx: TransactionSerializable;
}

export class EvmAdapter implements NetworkAdapter {
  readonly chain: ChainId;
  private client: PublicClient;
  private evmChain: EvmChain;
  private chainId: number;
  private usdt: Hex | null;
  private explorer: string;

  constructor(private opts: EvmAdapterOptions) {
    this.evmChain = opts.chain;
    this.chain = opts.chain;
    this.chainId = opts.chainIdOverride ?? CHAINS[opts.chain].evmChainId!;
    this.usdt = opts.usdtAddress === null ? null : ((opts.usdtAddress ?? USDT[opts.chain].address) as Hex);
    this.explorer = opts.explorerTxBase ?? EXPLORERS[opts.chain];
    const transport = opts.transport ?? http(opts.rpcUrl);
    this.client = createPublicClient({ transport }) as PublicClient;
  }

  validateAddress(address: string): boolean {
    // Mixed-case addresses must have a valid EIP-55 checksum; all-lower/upper are accepted.
    return isAddress(address, { strict: true });
  }

  private usdtAddress(): Hex {
    if (!this.usdt) throw new TransferError('USDT is not available on this network', 'unsupported');
    return this.usdt;
  }

  async getTokenBalances(address: string, tokens: string[]): Promise<Record<string, bigint>> {
    if (!tokens.length) return {};
    const owner = getAddress(address);
    const res = await this.client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts: tokens.map((t) => ({ address: getAddress(t), abi: erc20Abi, functionName: 'balanceOf' as const, args: [owner] as const })),
    });
    const out: Record<string, bigint> = {};
    res.forEach((r, i) => { out[tokens[i]!] = r.status === 'success' ? (r.result as bigint) : 0n; });
    return out;
  }

  async tokenMetadata(token: string): Promise<TokenMeta> {
    const a = getAddress(token);
    const [decimals, symbol, name] = await this.client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts: [
        { address: a, abi: erc20Abi, functionName: 'decimals' },
        { address: a, abi: erc20Abi, functionName: 'symbol' },
        { address: a, abi: erc20Abi, functionName: 'name' },
      ],
    });
    if (decimals.status !== 'success') throw new TransferError('Not an ERC20 token', 'unsupported');
    return {
      decimals: Number(decimals.result),
      symbol: symbol.status === 'success' ? String(symbol.result) : undefined,
      name: name.status === 'success' ? String(name.result) : undefined,
    };
  }

  async discoverTokens(address: string): Promise<DiscoveredToken[]> {
    if (!this.opts.alchemyDiscovery) return [];
    const r = (await this.client.request({
      method: 'alchemy_getTokenBalances' as never,
      params: [getAddress(address), 'erc20'] as never,
    })) as { tokenBalances?: Array<{ contractAddress: string; tokenBalance: string | null }> };
    return (r.tokenBalances ?? [])
      .map((t) => ({ address: getAddress(t.contractAddress), amount: t.tokenBalance ? BigInt(t.tokenBalance) : 0n }))
      .filter((t) => t.amount > 0n);
  }

  async getBalances(address: string): Promise<Balances> {
    if (!this.validateAddress(address)) throw new TransferError('Invalid address', 'invalid_address');
    const a = getAddress(address);
    const [native, usdt] = await Promise.all([
      this.client.getBalance({ address: a }),
      this.usdt
        ? this.client.readContract({ address: this.usdt, abi: erc20Abi, functionName: 'balanceOf', args: [a] })
        : Promise.resolve(undefined),
    ]);
    return { chain: this.chain, address: a, native, usdt };
  }

  async prepareTransfer(req: TransferRequest): Promise<PreparedTransfer> {
    assertPositive(req.amount);
    if (!this.validateAddress(req.from) || !this.validateAddress(req.to)) {
      throw new TransferError('Invalid address', 'invalid_address');
    }
    const from = getAddress(req.from);
    const to = getAddress(req.to);
    if (from === to) throw new TransferError('Sending to yourself', 'self_transfer');
    const token = req.asset === 'native' ? null : tokenOf(req, this.usdt ? { address: this.usdt, decimals: 0, symbol: 'USDT' } : null);
    if (token && !this.validateAddress(token.address)) throw new TransferError('Invalid token contract', 'unsupported');
    if (token && to === getAddress(token.address)) {
      // Tokens sent to the token contract itself are lost forever.
      throw new TransferError('Recipient is the token contract', 'invalid_address');
    }

    const call =
      !token
        ? { to, value: req.amount, data: undefined as Hex | undefined }
        : {
            to: getAddress(token.address),
            value: 0n,
            data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, req.amount] }),
          };

    const [nonce, gasEstimate, balances] = await Promise.all([
      this.client.getTransactionCount({ address: from, blockTag: 'pending' }),
      this.client.estimateGas({ account: from, to: call.to, value: call.value, data: call.data }),
      this.getBalances(from),
    ]);
    const gas = (gasEstimate * GAS_BUFFER_PCT) / 100n;

    let tx: TransactionSerializable;
    let maxFee: bigint;
    if (LEGACY_GAS[this.evmChain]) {
      const gasPrice = await this.client.getGasPrice();
      tx = { type: 'legacy', chainId: this.chainId, nonce, gas, gasPrice, to: call.to, value: call.value, data: call.data };
      maxFee = gas * gasPrice;
    } else {
      const fees = await this.client.estimateFeesPerGas({ type: 'eip1559', chain: null });
      tx = {
        type: 'eip1559', chainId: this.chainId, nonce, gas,
        maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        to: call.to, value: call.value, data: call.data,
      };
      maxFee = gas * fees.maxFeePerGas;
    }

    const needNative = maxFee + (req.asset === 'native' ? req.amount : 0n);
    if (balances.native < needNative) {
      throw new TransferError(
        req.asset === 'native' ? 'Insufficient balance' : `Not enough ${CHAINS[this.chain].nativeSymbol} for the network fee`,
        req.asset === 'native' ? 'insufficient_funds' : 'insufficient_fee',
      );
    }
    if (req.asset === 'usdt' && (balances.usdt ?? 0n) < req.amount) {
      throw new TransferError('Insufficient USDT balance', 'insufficient_funds');
    }
    if (req.asset === 'token') {
      const bal = (await this.getTokenBalances(from, [token!.address]))[token!.address] ?? 0n;
      if (bal < req.amount) throw new TransferError('Insufficient token balance', 'insufficient_funds');
    }

    const payload: EvmPayload = { tx };
    return {
      request: { ...req, from, to },
      fee: { amount: maxFee, symbol: CHAINS[this.chain].nativeSymbol, note: 'Maximum; usually less is charged' },
      payload,
    };
  }

  async signTransfer(prepared: PreparedTransfer, privateKey: Uint8Array): Promise<SignedTransfer> {
    const { tx } = prepared.payload as EvmPayload;
    const account = privateKeyToAccount(toHex(privateKey));
    if (account.address !== getAddress(prepared.request.from)) {
      throw new TransferError('Key does not match sender', 'verification_failed');
    }
    const raw = await account.signTransaction(tx);
    return { chain: this.chain, raw, txid: keccak256(raw) };
  }

  async broadcast(signed: SignedTransfer): Promise<string> {
    return this.client.sendRawTransaction({ serializedTransaction: signed.raw as Hex });
  }

  explorerTxUrl(txid: string): string {
    return this.explorer + txid;
  }
}
