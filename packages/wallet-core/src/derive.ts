/**
 * One mnemonic -> addresses for every supported network.
 *
 * Derivation paths match the most common wallets so users can import the same
 * seed phrase into MetaMask / Trust Wallet / Phantom / TronLink and see the same funds:
 *   Bitcoin  BIP84 native SegWit  m/84'/0'/0'/0/i      -> bc1q...
 *   EVM      BIP44 coin 60        m/44'/60'/0'/0/i     -> 0x...  (ETH, BSC, Polygon)
 *   Tron     BIP44 coin 195       m/44'/195'/0'/0/i    -> T...
 *   Solana   SLIP-0010 coin 501   m/44'/501'/i'/0'     -> base58 (Phantom default)
 */
import { HDKey } from '@scure/bip32';
import { createBase58check, base58 } from '@scure/base';
import { p2wpkh, NETWORK, TEST_NETWORK } from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { mnemonicToSeed } from './mnemonic.js';
import { slip10DerivePath } from './slip10.js';
import type { KeyFamily } from './chains.js';

export type BitcoinNetwork = 'mainnet' | 'testnet';

export const PATHS = {
  bitcoin: (i: number, net: BitcoinNetwork = 'mainnet') => `m/84'/${net === 'mainnet' ? 0 : 1}'/0'/0/${i}`,
  evm: (i: number) => `m/44'/60'/0'/0/${i}`,
  tron: (i: number) => `m/44'/195'/0'/0/${i}`,
  solana: (i: number) => `m/44'/501'/${i}'/0'`,
} as const;

export interface DerivedAccount {
  family: KeyFamily;
  path: string;
  address: string;
  /** Public key, hex */
  publicKey: string;
}

export interface DerivedAccounts {
  index: number;
  bitcoin: DerivedAccount;
  evm: DerivedAccount;
  tron: DerivedAccount;
  solana: DerivedAccount;
}

const base58check = createBase58check(sha256);

function assertIndex(i: number) {
  if (!Number.isInteger(i) || i < 0 || i >= 0x80000000) throw new Error(`Bad account index: ${i}`);
}

/** EIP-55 checksummed address from an uncompressed secp256k1 public key. */
export function evmAddressFromPublicKey(pub: Uint8Array): string {
  const uncompressed = pub.length === 65 ? pub : secp256k1.Point.fromBytes(pub).toBytes(false);
  const addr = bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20));
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(addr)));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(hash[i]!, 16) >= 8 ? addr[i]!.toUpperCase() : addr[i];
  return out;
}

/** Tron address: 0x41 + last 20 bytes of keccak(pubkey), base58check-encoded. */
export function tronAddressFromPublicKey(pub: Uint8Array): string {
  const uncompressed = pub.length === 65 ? pub : secp256k1.Point.fromBytes(pub).toBytes(false);
  const body = new Uint8Array(21);
  body[0] = 0x41;
  body.set(keccak_256(uncompressed.slice(1)).slice(-20), 1);
  return base58check.encode(body);
}

export function isValidTronAddress(addr: string): boolean {
  try {
    const b = base58check.decode(addr);
    return b.length === 21 && b[0] === 0x41;
  } catch {
    return false;
  }
}

function secpNode(root: HDKey, path: string) {
  const node = root.derive(path);
  if (!node.privateKey || !node.publicKey) throw new Error('Derivation failed');
  return node;
}

/** Derive public account info for all families. Private keys are wiped before returning. */
export function deriveAccounts(
  mnemonic: string,
  opts: { index?: number; passphrase?: string; bitcoinNetwork?: BitcoinNetwork } = {},
): DerivedAccounts {
  const index = opts.index ?? 0;
  assertIndex(index);
  const btcNet = opts.bitcoinNetwork ?? 'mainnet';
  const seed = mnemonicToSeed(mnemonic, opts.passphrase ?? '');
  const root = HDKey.fromMasterSeed(seed);
  try {
    const btcPath = PATHS.bitcoin(index, btcNet);
    const btc = secpNode(root, btcPath);
    const btcAddr = p2wpkh(btc.publicKey!, btcNet === 'mainnet' ? NETWORK : TEST_NETWORK).address!;

    const evmPath = PATHS.evm(index);
    const evm = secpNode(root, evmPath);

    const tronPath = PATHS.tron(index);
    const tron = secpNode(root, tronPath);

    const solPath = PATHS.solana(index);
    const sol = slip10DerivePath(seed, solPath);
    const solPub = ed25519.getPublicKey(sol.key);
    sol.key.fill(0);
    sol.chainCode.fill(0);

    const result: DerivedAccounts = {
      index,
      bitcoin: { family: 'bitcoin', path: btcPath, address: btcAddr, publicKey: bytesToHex(btc.publicKey!) },
      evm: { family: 'evm', path: evmPath, address: evmAddressFromPublicKey(evm.publicKey!), publicKey: bytesToHex(evm.publicKey!) },
      tron: { family: 'tron', path: tronPath, address: tronAddressFromPublicKey(tron.publicKey!), publicKey: bytesToHex(tron.publicKey!) },
      solana: { family: 'solana', path: solPath, address: base58.encode(solPub), publicKey: bytesToHex(solPub) },
    };
    btc.wipePrivateData();
    evm.wipePrivateData();
    tron.wipePrivateData();
    return result;
  } finally {
    root.wipePrivateData();
    seed.fill(0);
  }
}

/**
 * Private key for signing. Returned bytes MUST be wiped by the caller
 * (`key.fill(0)`) right after signing. Never log, persist or send it anywhere.
 */
export function derivePrivateKey(
  mnemonic: string,
  family: KeyFamily,
  opts: { index?: number; passphrase?: string; bitcoinNetwork?: BitcoinNetwork } = {},
): Uint8Array {
  const index = opts.index ?? 0;
  assertIndex(index);
  const seed = mnemonicToSeed(mnemonic, opts.passphrase ?? '');
  try {
    if (family === 'solana') {
      const node = slip10DerivePath(seed, PATHS.solana(index));
      node.chainCode.fill(0);
      return node.key;
    }
    const root = HDKey.fromMasterSeed(seed);
    try {
      const path =
        family === 'bitcoin' ? PATHS.bitcoin(index, opts.bitcoinNetwork) : family === 'evm' ? PATHS.evm(index) : PATHS.tron(index);
      const node = secpNode(root, path);
      const key = node.privateKey!.slice();
      node.wipePrivateData();
      return key;
    } finally {
      root.wipePrivateData();
    }
  } finally {
    seed.fill(0);
  }
}
