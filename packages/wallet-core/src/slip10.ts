/**
 * SLIP-0010 key derivation for ed25519 (used by Solana wallets such as Phantom).
 *
 * This is key *derivation* only (HMAC-SHA512 chain from the spec), built on the
 * audited @noble/hashes primitives. ed25519 supports hardened derivation only.
 * Cross-checked in tests against the independent `ed25519-hd-key` package.
 * Spec: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

const HARDENED = 0x80000000;

export interface Slip10Node {
  key: Uint8Array; // 32-byte ed25519 private seed
  chainCode: Uint8Array;
}

export function slip10Master(seed: Uint8Array): Slip10Node {
  const I = hmac(sha512, utf8ToBytes('ed25519 seed'), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function ser32(i: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, i >>> 0, false);
  return b;
}

export function slip10Child(parent: Slip10Node, index: number): Slip10Node {
  if (index < HARDENED) throw new Error('ed25519 supports hardened derivation only');
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0;
  data.set(parent.key, 1);
  data.set(ser32(index), 33);
  const I = hmac(sha512, parent.chainCode, data);
  data.fill(0);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

/** Parse "m/44'/501'/0'/0'" — every segment must be hardened. */
export function parseHardenedPath(path: string): number[] {
  const parts = path.split('/');
  if (parts[0] !== 'm') throw new Error(`Bad path: ${path}`);
  return parts.slice(1).map((p) => {
    if (!/^\d+'$/.test(p)) throw new Error(`ed25519 path segments must be hardened: ${path}`);
    const n = Number(p.slice(0, -1));
    if (n >= HARDENED) throw new Error(`Index too large: ${p}`);
    return n + HARDENED;
  });
}

export function slip10DerivePath(seed: Uint8Array, path: string): Slip10Node {
  let node = slip10Master(seed);
  for (const idx of parseHardenedPath(path)) {
    const next = slip10Child(node, idx);
    node.key.fill(0);
    node.chainCode.fill(0);
    node = next;
  }
  return node;
}
