import {
  generateMnemonic as bip39Generate,
  mnemonicToSeedSync,
  validateMnemonic as bip39Validate,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

/** Normalise user input: trim, lowercase, collapse whitespace. */
export function normalizeMnemonic(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).join(' ');
}

/**
 * Generate a new BIP39 mnemonic.
 * 12 words = 128 bits of entropy (default, same as most wallets), 24 words = 256 bits.
 * Entropy comes from the platform CSPRNG (crypto.getRandomValues).
 */
export function generateMnemonic(words: 12 | 24 = 12): string {
  return bip39Generate(wordlist, words === 24 ? 256 : 128);
}

export function isValidMnemonic(input: string): boolean {
  return bip39Validate(normalizeMnemonic(input), wordlist);
}

/** BIP39 seed (64 bytes). Caller must wipe the result after use. */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Uint8Array {
  const m = normalizeMnemonic(mnemonic);
  if (!bip39Validate(m, wordlist)) throw new Error('Invalid mnemonic');
  return mnemonicToSeedSync(m, passphrase);
}
