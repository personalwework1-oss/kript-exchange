/**
 * Every address is checked two ways:
 *  1. against published reference vectors where they exist;
 *  2. against an independent implementation (bitcoinjs-lib, viem, tronweb,
 *     ed25519-hd-key + @solana/web3.js) for many random mnemonics.
 * If any of these disagree, users would see "empty" wallets after importing a seed elsewhere.
 */
import { describe, it, expect } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import { mnemonicToAccount } from 'viem/accounts';
import { TronWeb } from 'tronweb';
import { derivePath as edDerivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import * as bitcoin from 'bitcoinjs-lib';
import { HDKey } from '@scure/bip32';
import {
  deriveAccounts,
  derivePrivateKey,
  generateMnemonic,
  isValidMnemonic,
  isValidTronAddress,
  normalizeMnemonic,
  PATHS,
} from '../src/index.js';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('mnemonic', () => {
  it('generates valid 12 and 24 word phrases', () => {
    const m12 = generateMnemonic();
    const m24 = generateMnemonic(24);
    expect(m12.split(' ')).toHaveLength(12);
    expect(m24.split(' ')).toHaveLength(24);
    expect(isValidMnemonic(m12)).toBe(true);
    expect(isValidMnemonic(m24)).toBe(true);
  });

  it('never repeats', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateMnemonic()));
    expect(set.size).toBe(50);
  });

  it('rejects bad checksum and unknown words', () => {
    expect(isValidMnemonic(ABANDON.replace(/about$/, 'abandon'))).toBe(false);
    expect(isValidMnemonic(ABANDON.replace(/^abandon/, 'notaword'))).toBe(false);
    expect(() => deriveAccounts('hello world')).toThrow();
  });

  it('normalises whitespace and case', () => {
    const messy = `  ${ABANDON.toUpperCase().split(' ').join('   ')}\n`;
    expect(normalizeMnemonic(messy)).toBe(ABANDON);
    expect(deriveAccounts(messy).evm.address).toBe(deriveAccounts(ABANDON).evm.address);
  });
});

describe('reference vectors (abandon ... about)', () => {
  const a = deriveAccounts(ABANDON);

  it('Bitcoin BIP84 — vector from the BIP84 spec', () => {
    expect(a.bitcoin.address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    expect(a.bitcoin.path).toBe("m/84'/0'/0'/0/0");
  });

  it('EVM — well-known MetaMask address for this phrase', () => {
    expect(a.evm.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
  });

  it('Tron — well-known TronLink/Trust address for this phrase', () => {
    expect(a.tron.address).toBe('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
  });

  it('Solana — well-known Phantom address for this phrase', () => {
    expect(a.solana.address).toBe('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
  });

  it('Tron / Solana produce valid-format addresses', () => {
    expect(isValidTronAddress(a.tron.address)).toBe(true);
    expect(a.tron.address.startsWith('T')).toBe(true);
    expect(a.solana.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it('Bitcoin testnet uses coin type 1 and tb1 prefix', () => {
    const t = deriveAccounts(ABANDON, { bitcoinNetwork: 'testnet' });
    expect(t.bitcoin.address.startsWith('tb1q')).toBe(true);
    expect(t.bitcoin.path).toBe("m/84'/1'/0'/0/0");
  });
});

describe('cross-check against independent libraries', () => {
  const phrases = [ABANDON, ...Array.from({ length: 15 }, () => generateMnemonic())];

  for (const [n, m] of phrases.entries()) {
    for (const index of [0, 1, 7]) {
      it(`phrase #${n} index ${index}`, async () => {
        const ours = deriveAccounts(m, { index });
        const seed = mnemonicToSeedSync(m);

        // EVM — viem
        expect(ours.evm.address).toBe(mnemonicToAccount(m, { addressIndex: index }).address);

        // Tron — tronweb from the same secp256k1 private key
        const tronPriv = derivePrivateKey(m, 'tron', { index });
        expect(ours.tron.address).toBe(TronWeb.address.fromPrivateKey(bytesToHex(tronPriv)));
        tronPriv.fill(0);

        // Solana — ed25519-hd-key + @solana/web3.js (Phantom path)
        const sol = edDerivePath(PATHS.solana(index), bytesToHex(seed));
        expect(ours.solana.address).toBe(Keypair.fromSeed(Uint8Array.from(sol.key)).publicKey.toBase58());

        // Bitcoin — bitcoinjs-lib address encoding from an independent node derivation
        const node = HDKey.fromMasterSeed(seed).derive(PATHS.bitcoin(index));
        const bjs = bitcoin.payments.p2wpkh({ pubkey: node.publicKey! }).address;
        expect(ours.bitcoin.address).toBe(bjs);
      });
    }
  }
});

describe('private keys', () => {
  it('match the public addresses', async () => {
    const m = generateMnemonic();
    const acc = deriveAccounts(m);
    const evmKey = derivePrivateKey(m, 'evm');
    expect(evmKey).toHaveLength(32);
    const solKey = derivePrivateKey(m, 'solana');
    expect(Keypair.fromSeed(solKey).publicKey.toBase58()).toBe(acc.solana.address);
    evmKey.fill(0);
    solKey.fill(0);
  });

  it('BIP39 passphrase changes every address', () => {
    const a = deriveAccounts(ABANDON);
    const b = deriveAccounts(ABANDON, { passphrase: 'secret' });
    for (const k of ['bitcoin', 'evm', 'tron', 'solana'] as const) expect(a[k].address).not.toBe(b[k].address);
  });

  it('rejects bad indexes', () => {
    expect(() => deriveAccounts(ABANDON, { index: -1 })).toThrow();
    expect(() => deriveAccounts(ABANDON, { index: 1.5 })).toThrow();
    expect(() => deriveAccounts(ABANDON, { index: 2 ** 31 })).toThrow();
  });
});
