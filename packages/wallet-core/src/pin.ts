import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * PIN attempt policy (enforced by the app; the vault itself only knows right/wrong).
 *   failures 1–4  : retry immediately
 *   5th failure   : 30 s pause, then 1 min, 5 min, 15 min, 1 h
 *   10th failure  : PIN disabled — unlock with the password (or biometrics), which resets it
 */
export const PIN_MAX_FAILURES = 10;
const LADDER_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export interface PinState {
  failures: number;
  /** ms since epoch until which attempts are blocked */
  lockedUntil: number;
}

export const PIN_STATE_FRESH: PinState = { failures: 0, lockedUntil: 0 };

export function pinLockoutMs(failures: number): number {
  if (failures < 5) return 0;
  return LADDER_MS[Math.min(failures - 5, LADDER_MS.length - 1)]!;
}

export function pinDisabled(s: PinState): boolean {
  return s.failures >= PIN_MAX_FAILURES;
}

/** ms to wait before the next attempt is allowed (0 = now). */
export function pinWaitMs(s: PinState, now: number): number {
  return Math.max(0, s.lockedUntil - now);
}

export function pinFailure(s: PinState, now: number): PinState {
  const failures = s.failures + 1;
  return { failures, lockedUntil: now + pinLockoutMs(failures) };
}

/** Obviously guessable PINs that the app refuses at setup. */
export function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true; // 000000, 111111…
  const asc = '01234567890123456789';
  const desc = '98765432109876543210';
  if (asc.includes(pin) || desc.includes(pin)) return true; // 123456, 654321, 890123…
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return true; // 121212, 123123
  return ['112233', '159753', '147258', '102030', '696969', '131313'].includes(pin);
}

/**
 * "Is a decoy PIN set?" marker. Stored next to the vault as either this value (decoy on)
 * or 32 random bytes (off). Only someone holding the real seed phrase can tell which —
 * so the storage looks identical with and without a decoy wallet.
 */
export function decoyMarker(mnemonic: string): string {
  return bytesToHex(hmac(sha256, utf8ToBytes(mnemonic), utf8ToBytes('kript-decoy-on-v1')));
}
export function randomMarker(): string {
  return bytesToHex(randomBytes(32));
}
