/**
 * Solana: SOL and USDT (SPL token, classic Token program).
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Commitment,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { USDT } from '../chains.js';
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

export interface SolanaAdapterOptions {
  rpcUrl: string;
  /** Override mint (devnet uses a different USDT/test token) */
  usdtMint?: string;
  usdtDecimals?: number;
  commitment?: Commitment;
  /** Priority fee, micro-lamports per compute unit. Default 10_000 (cheap). */
  priorityFee?: number;
  connection?: Connection;
}

const BASE_FEE = 5_000n; // lamports per signature
const ATA_RENT = 2_039_280n; // rent-exempt minimum for a token account (165 bytes)
const CU_LIMIT = 60_000;

interface SolPayload {
  /** Built in prepare, without blockhash; blockhash is fetched at signing time */
  createsRecipientAccount: boolean;
  /** Token program of the mint (classic Token or Token-2022) */
  tokenProgram?: string;
}

const TOKEN_PROGRAMS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];

export class SolanaAdapter implements NetworkAdapter {
  readonly chain = 'solana' as const;
  private conn: Connection;
  private mint: PublicKey;
  private decimals: number;
  private priorityFee: number;

  constructor(opts: SolanaAdapterOptions) {
    this.conn = opts.connection ?? new Connection(opts.rpcUrl, opts.commitment ?? 'confirmed');
    this.mint = new PublicKey(opts.usdtMint ?? USDT.solana.address);
    this.decimals = opts.usdtDecimals ?? USDT.solana.decimals;
    this.priorityFee = opts.priorityFee ?? 10_000;
  }

  /** Wallet (owner) addresses only: must be a valid on-curve ed25519 public key. */
  validateAddress(address: string): boolean {
    try {
      return PublicKey.isOnCurve(new PublicKey(address).toBytes());
    } catch {
      return false;
    }
  }

  private mintOf(req: TransferRequest): { mint: PublicKey; decimals: number } {
    if (req.asset === 'usdt') return { mint: this.mint, decimals: this.decimals };
    if (req.asset === 'token' && req.token) return { mint: new PublicKey(req.token.address), decimals: req.token.decimals };
    throw new TransferError('Unsupported token', 'unsupported');
  }

  /** All SPL token holdings (classic + Token-2022), summed per mint. */
  private async holdings(address: string): Promise<Map<string, bigint>> {
    const owner = new PublicKey(address);
    const res = await Promise.all(TOKEN_PROGRAMS.map((programId) => this.conn.getParsedTokenAccountsByOwner(owner, { programId })));
    const m = new Map<string, bigint>();
    for (const r of res) {
      for (const a of r.value) {
        const info = (a.account.data as { parsed: { info: { mint: string; tokenAmount: { amount: string } } } }).parsed.info;
        m.set(info.mint, (m.get(info.mint) ?? 0n) + BigInt(info.tokenAmount.amount));
      }
    }
    return m;
  }

  async getTokenBalances(address: string, tokens: string[]): Promise<Record<string, bigint>> {
    const h = await this.holdings(address);
    return Object.fromEntries(tokens.map((t) => [t, h.get(t) ?? 0n]));
  }

  async discoverTokens(address: string): Promise<DiscoveredToken[]> {
    const h = await this.holdings(address);
    return [...h.entries()].filter(([, v]) => v > 0n).map(([a, v]) => ({ address: a, amount: v }));
  }

  async tokenMetadata(token: string): Promise<TokenMeta> {
    const info = await this.conn.getParsedAccountInfo(new PublicKey(token));
    const v = info.value;
    if (!v || !TOKEN_PROGRAMS.some((p) => p.equals(v.owner))) throw new TransferError('Not an SPL token mint', 'unsupported');
    const parsed = (v.data as { parsed?: { type?: string; info?: { decimals?: number } } }).parsed;
    if (parsed?.type !== 'mint' || parsed.info?.decimals === undefined) throw new TransferError('Not a mint', 'unsupported');
    return { decimals: parsed.info.decimals };
  }

  async getBalances(address: string): Promise<Balances> {
    if (!this.validateAddress(address)) throw new TransferError('Invalid address', 'invalid_address');
    const owner = new PublicKey(address);
    const [native, tokens] = await Promise.all([
      this.conn.getBalance(owner),
      this.conn.getParsedTokenAccountsByOwner(owner, { mint: this.mint }),
    ]);
    const usdt = tokens.value.reduce(
      (s, a) => s + BigInt((a.account.data as { parsed: { info: { tokenAmount: { amount: string } } } }).parsed.info.tokenAmount.amount),
      0n,
    );
    return { chain: 'solana', address, native: BigInt(native), usdt };
  }

  /** Build instructions (pure, no network). Exported for tests. */
  buildInstructions(req: TransferRequest, createRecipientAta: boolean, tokenProgram: PublicKey = TOKEN_PROGRAM_ID) {
    const from = new PublicKey(req.from);
    const to = new PublicKey(req.to);
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.priorityFee }),
    ];
    if (req.asset === 'native') {
      ixs.push(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: req.amount }));
      return ixs;
    }
    const { mint, decimals } = this.mintOf(req);
    const srcAta = getAssociatedTokenAddressSync(mint, from, false, tokenProgram);
    const dstAta = getAssociatedTokenAddressSync(mint, to, false, tokenProgram);
    if (createRecipientAta) {
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(from, dstAta, to, mint, tokenProgram));
    }
    ixs.push(createTransferCheckedInstruction(srcAta, mint, dstAta, from, req.amount, decimals, [], tokenProgram));
    return ixs;
  }

  private priorityLamports(): bigint {
    return (BigInt(CU_LIMIT) * BigInt(this.priorityFee) + 999_999n) / 1_000_000n;
  }

  async prepareTransfer(req: TransferRequest): Promise<PreparedTransfer> {
    assertPositive(req.amount);
    if (!this.validateAddress(req.from) || !this.validateAddress(req.to)) {
      throw new TransferError('Invalid address (must be a wallet address)', 'invalid_address');
    }
    if (req.from === req.to) throw new TransferError('Sending to yourself', 'self_transfer');

    const balances = await this.getBalances(req.from);
    let createsRecipientAccount = false;
    let tokenProgram: PublicKey | undefined;
    let fee = BASE_FEE + this.priorityLamports();
    if (req.asset !== 'native') {
      const { mint } = this.mintOf(req);
      const mintInfo = await this.conn.getAccountInfo(mint);
      tokenProgram = TOKEN_PROGRAMS.find((p) => mintInfo && p.equals(mintInfo.owner));
      if (!tokenProgram) throw new TransferError('Unknown token program', 'unsupported');
      const bal = req.asset === 'usdt' ? (balances.usdt ?? 0n) : ((await this.getTokenBalances(req.from, [mint.toBase58()]))[mint.toBase58()] ?? 0n);
      if (bal < req.amount) throw new TransferError('Insufficient token balance', 'insufficient_funds');
      const dstAta = getAssociatedTokenAddressSync(mint, new PublicKey(req.to), false, tokenProgram);
      createsRecipientAccount = (await this.conn.getAccountInfo(dstAta)) === null;
      if (createsRecipientAccount) fee += ATA_RENT; // sender pays rent for the recipient's USDT account
      if (balances.native < fee) throw new TransferError('Not enough SOL for the network fee', 'insufficient_fee');
    } else if (balances.native < req.amount + fee) {
      throw new TransferError('Insufficient balance', 'insufficient_funds');
    }
    const payload: SolPayload = { createsRecipientAccount, tokenProgram: tokenProgram?.toBase58() };
    return {
      request: req,
      fee: {
        amount: fee,
        symbol: 'SOL',
        note: createsRecipientAccount ? 'Includes ~0.002 SOL to open the recipient USDT account' : undefined,
      },
      payload,
    };
  }

  /** Assemble + sign with a given blockhash (pure). Exported for tests. */
  async signWithBlockhash(prepared: PreparedTransfer, privateKey: Uint8Array, blockhash: string, lastValidBlockHeight: number) {
    const kp = Keypair.fromSeed(privateKey);
    if (kp.publicKey.toBase58() !== prepared.request.from) {
      throw new TransferError('Key does not match sender', 'verification_failed');
    }
    const { createsRecipientAccount, tokenProgram } = prepared.payload as SolPayload;
    const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight });
    tx.add(...this.buildInstructions(prepared.request, createsRecipientAccount, tokenProgram ? new PublicKey(tokenProgram) : TOKEN_PROGRAM_ID));
    tx.sign(kp);
    kp.secretKey.fill(0);
    const sig = tx.signature!;
    const { base58 } = await import('@scure/base');
    return { chain: 'solana' as const, raw: tx.serialize().toString('base64'), txid: base58.encode(sig) };
  }

  async signTransfer(prepared: PreparedTransfer, privateKey: Uint8Array): Promise<SignedTransfer> {
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash();
    return this.signWithBlockhash(prepared, privateKey, blockhash, lastValidBlockHeight);
  }

  async broadcast(signed: SignedTransfer): Promise<string> {
    return this.conn.sendRawTransaction(Buffer.from(signed.raw, 'base64'), { maxRetries: 3 });
  }

  explorerTxUrl(txid: string): string {
    return `https://solscan.io/tx/${txid}`;
  }
}
