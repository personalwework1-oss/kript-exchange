/**
 * Encrypted vault for the seed phrase (envelope encryption).
 *
 *   secret (mnemonic) --AES-256-GCM--> ciphertext            with a random data key (DEK)
 *   DEK               --AES-256-GCM--> one "slot" per unlock method
 *
 * Unlock methods (slots):
 *   - password : key = scrypt(password, salt)
 *   - prf      : key = HKDF-SHA256(passkey PRF output, salt)   (Face ID / fingerprint via WebAuthn PRF)
 *
 * The same vault blob can be stored on the device and, as a backup, in the
 * user's own iCloud / Google Drive: without one of the slot secrets it is useless.
 * Nothing in here ever leaves the device unencrypted.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';

const VERSION = 1 as const;
const DATA_AAD = utf8ToBytes('kript-vault-v1:data');

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** ~64 MiB memory. Tuned for phones; raise N on desktop if unlock time allows. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 16, r: 8, p: 1 };

export interface VaultSecret {
  mnemonic: string;
  /** Optional BIP39 passphrase ("25th word") */
  passphrase?: string;
}

interface Box {
  iv: string; // base64
  ct: string; // base64 (ciphertext + 16-byte GCM tag)
}

export type VaultSlot =
  | { id: string; type: 'password'; kdf: { name: 'scrypt'; salt: string } & ScryptParams; wrap: Box }
  | { id: string; type: 'prf'; credentialId: string; salt: string; wrap: Box }
  | { id: string; type: 'pin'; kdf: { name: 'scrypt'; salt: string } & ScryptParams; wrap: Box };

/**
 * PIN slots: a 6-digit PIN has only 10^6 values, so it is never enough on its own.
 * key = HKDF(deviceSecret ‖ scrypt(PIN, salt), salt). The 32-byte device secret lives in the
 * phone's keychain/keystore (this device only) and is never backed up, so a copied vault
 * cannot be brute-forced off the device. Attempt limits are enforced by the app (see pin.ts).
 */
export const PIN_SCRYPT: ScryptParams = { N: 2 ** 14, r: 8, p: 1 };

export interface Vault {
  v: typeof VERSION;
  cipher: 'aes-256-gcm';
  data: Box;
  slots: VaultSlot[];
}

export type SlotInput =
  | { type: 'password'; password: string; scrypt?: ScryptParams }
  | { type: 'prf'; credentialId: string; prfOutput: Uint8Array }
  | { type: 'pin'; pin: string; deviceSecret: Uint8Array; scrypt?: ScryptParams };

export type UnlockInput =
  | { type: 'password'; password: string }
  | { type: 'prf'; credentialId: string; prfOutput: Uint8Array }
  | { type: 'pin'; pin: string; deviceSecret: Uint8Array };

export class VaultError extends Error {}

const MIN_PASSWORD = 8;

function seal(key: Uint8Array, plain: Uint8Array, aad: Uint8Array): Box {
  const iv = randomBytes(12);
  const ct = gcm(key, iv, aad).encrypt(plain);
  return { iv: base64.encode(iv), ct: base64.encode(ct) };
}

function open(key: Uint8Array, box: Box, aad: Uint8Array): Uint8Array {
  try {
    return gcm(key, base64.decode(box.iv), aad).decrypt(base64.decode(box.ct));
  } catch {
    throw new VaultError('Wrong password/passkey or corrupted vault');
  }
}

function slotAad(id: string, type: string): Uint8Array {
  return utf8ToBytes(`kript-vault-v1:slot:${type}:${id}`);
}

function newSlotId(): string {
  return base64.encode(randomBytes(9)).replace(/[+/=]/g, 'x');
}

function assertPinInput(pin: string, deviceSecret: Uint8Array) {
  if (!/^\d{6}$/.test(pin)) throw new VaultError('PIN must be 6 digits');
  if (deviceSecret.length !== 32) throw new VaultError('Device secret must be 32 bytes');
}

function slotKey(slot: VaultSlot, input: UnlockInput): Uint8Array {
  if (slot.type === 'pin' && input.type === 'pin') {
    assertPinInput(input.pin, input.deviceSecret);
    const { N, r, p, salt } = slot.kdf;
    const saltB = base64.decode(salt);
    const stretched = scrypt(utf8ToBytes(input.pin), saltB, { N, r, p, dkLen: 32 });
    const ikm = new Uint8Array(64);
    ikm.set(input.deviceSecret, 0);
    ikm.set(stretched, 32);
    const key = hkdf(sha256, ikm, saltB, utf8ToBytes('kript-vault-v1:pin'), 32);
    ikm.fill(0);
    stretched.fill(0);
    return key;
  }
  if (slot.type === 'password' && input.type === 'password') {
    const { N, r, p, salt } = slot.kdf;
    return scrypt(utf8ToBytes(input.password.normalize('NFKC')), base64.decode(salt), { N, r, p, dkLen: 32 });
  }
  if (slot.type === 'prf' && input.type === 'prf') {
    if (input.prfOutput.length < 32) throw new VaultError('PRF output too short');
    return hkdf(sha256, input.prfOutput, base64.decode(slot.salt), utf8ToBytes('kript-vault-v1:prf'), 32);
  }
  throw new VaultError('Slot type mismatch');
}

function makeSlot(dek: Uint8Array, input: SlotInput): VaultSlot {
  const id = newSlotId();
  if (input.type === 'password') {
    if (input.password.length < MIN_PASSWORD) throw new VaultError(`Password must be at least ${MIN_PASSWORD} characters`);
    const params = input.scrypt ?? DEFAULT_SCRYPT;
    const salt = base64.encode(randomBytes(16));
    const slot: VaultSlot = {
      id, type: 'password', kdf: { name: 'scrypt', salt, ...params }, wrap: { iv: '', ct: '' },
    };
    const key = slotKey(slot, { type: 'password', password: input.password });
    slot.wrap = seal(key, dek, slotAad(id, 'password'));
    key.fill(0);
    return slot;
  }
  if (input.type === 'pin') {
    assertPinInput(input.pin, input.deviceSecret);
    const slot: VaultSlot = {
      id, type: 'pin', kdf: { name: 'scrypt', salt: base64.encode(randomBytes(16)), ...(input.scrypt ?? PIN_SCRYPT) }, wrap: { iv: '', ct: '' },
    };
    const key = slotKey(slot, input);
    slot.wrap = seal(key, dek, slotAad(id, 'pin'));
    key.fill(0);
    return slot;
  }
  const slot: VaultSlot = {
    id, type: 'prf', credentialId: input.credentialId, salt: base64.encode(randomBytes(32)), wrap: { iv: '', ct: '' },
  };
  const key = slotKey(slot, input);
  slot.wrap = seal(key, dek, slotAad(id, 'prf'));
  key.fill(0);
  return slot;
}

function unwrapDek(vault: Vault, input: UnlockInput): Uint8Array {
  const candidates = vault.slots.filter((s) =>
    input.type === 'prf' ? s.type === 'prf' && s.credentialId === input.credentialId : s.type === input.type,
  );
  if (!candidates.length) throw new VaultError('No matching unlock method in vault');
  for (const slot of candidates) {
    const key = slotKey(slot, input);
    try {
      return open(key, slot.wrap, slotAad(slot.id, slot.type));
    } catch {
      /* try next slot */
    } finally {
      key.fill(0);
    }
  }
  throw new VaultError('Wrong password/passkey or corrupted vault');
}

export function createVault(secret: VaultSecret, firstSlot: SlotInput): Vault {
  const dek = randomBytes(32);
  try {
    const plain = utf8ToBytes(JSON.stringify(secret));
    const data = seal(dek, plain, DATA_AAD);
    plain.fill(0);
    return { v: VERSION, cipher: 'aes-256-gcm', data, slots: [makeSlot(dek, firstSlot)] };
  } finally {
    dek.fill(0);
  }
}

export function unlockVault(vault: Vault, input: UnlockInput): VaultSecret {
  assertVault(vault);
  const dek = unwrapDek(vault, input);
  try {
    const plain = open(dek, vault.data, DATA_AAD);
    const secret = JSON.parse(new TextDecoder().decode(plain)) as VaultSecret;
    plain.fill(0);
    return secret;
  } finally {
    dek.fill(0);
  }
}

/** Add another unlock method (e.g. a passkey after creating with a password). */
export function addSlot(vault: Vault, unlock: UnlockInput, input: SlotInput): Vault {
  assertVault(vault);
  const dek = unwrapDek(vault, unlock);
  try {
    return { ...vault, slots: [...vault.slots, makeSlot(dek, input)] };
  } finally {
    dek.fill(0);
  }
}

/** Remove an unlock method. Refuses to remove the last one. Requires a working unlock. */
export function removeSlot(vault: Vault, unlock: UnlockInput, slotId: string): Vault {
  assertVault(vault);
  unwrapDek(vault, unlock).fill(0); // proves the caller can unlock
  const slots = vault.slots.filter((s) => s.id !== slotId);
  if (slots.length === vault.slots.length) throw new VaultError('Slot not found');
  if (!slots.length) throw new VaultError('Cannot remove the last unlock method');
  return { ...vault, slots };
}

export function assertVault(v: unknown): asserts v is Vault {
  const x = v as Vault;
  if (!x || x.v !== VERSION || x.cipher !== 'aes-256-gcm' || !x.data || !Array.isArray(x.slots) || !x.slots.length) {
    throw new VaultError('Unsupported or malformed vault');
  }
}

export function serializeVault(v: Vault): string {
  return JSON.stringify(v);
}

export function parseVault(s: string): Vault {
  const v = JSON.parse(s);
  assertVault(v);
  return v;
}

export function hasSlot(vault: Vault, type: VaultSlot['type']): boolean {
  return vault.slots.some((s) => s.type === type);
}

/** Replace all slots of `type` with a new one (e.g. change PIN). Requires a working unlock. */
export function replaceSlots(vault: Vault, unlock: UnlockInput, type: VaultSlot['type'], input: SlotInput | null): Vault {
  assertVault(vault);
  const dek = unwrapDek(vault, unlock);
  try {
    const kept = vault.slots.filter((s) => s.type !== type);
    const slots = input ? [...kept, makeSlot(dek, input)] : kept;
    if (!slots.length) throw new VaultError('Cannot remove the last unlock method');
    return { ...vault, slots };
  } finally {
    dek.fill(0);
  }
}
