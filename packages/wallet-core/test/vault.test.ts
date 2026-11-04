import { describe, it, expect } from 'vitest';
import { randomBytes } from '@noble/hashes/utils.js';
import {
  addSlot,
  createVault,
  generateMnemonic,
  parseVault,
  removeSlot,
  serializeVault,
  unlockVault,
  VaultError,
} from '../src/index.js';

// Low scrypt cost to keep tests fast. Production uses DEFAULT_SCRYPT.
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PW = 'correct horse battery';

describe('vault', () => {
  const mnemonic = generateMnemonic();

  it('round-trips with a password', () => {
    const v = createVault({ mnemonic }, { type: 'password', password: PW, scrypt: FAST });
    expect(unlockVault(v, { type: 'password', password: PW }).mnemonic).toBe(mnemonic);
  });

  it('does not contain the mnemonic in plaintext', () => {
    const s = serializeVault(createVault({ mnemonic }, { type: 'password', password: PW, scrypt: FAST }));
    for (const w of mnemonic.split(' ')) expect(s.includes(` ${w} `)).toBe(false);
    expect(s.includes(mnemonic)).toBe(false);
  });

  it('rejects a wrong password', () => {
    const v = createVault({ mnemonic }, { type: 'password', password: PW, scrypt: FAST });
    expect(() => unlockVault(v, { type: 'password', password: 'wrong password' })).toThrow(VaultError);
  });

  it('rejects short passwords', () => {
    expect(() => createVault({ mnemonic }, { type: 'password', password: '1234', scrypt: FAST })).toThrow(VaultError);
  });

  it('detects tampering with ciphertext', () => {
    const v = createVault({ mnemonic }, { type: 'password', password: PW, scrypt: FAST });
    const ct = v.data.ct;
    const flipped = (ct[5] === 'A' ? 'B' : 'A');
    const bad = { ...v, data: { ...v.data, ct: ct.slice(0, 5) + flipped + ct.slice(6) } };
    expect(() => unlockVault(bad, { type: 'password', password: PW })).toThrow(VaultError);
  });

  it('supports a passkey (PRF) slot alongside the password', () => {
    const prf = randomBytes(32);
    let v = createVault({ mnemonic, passphrase: 'p' }, { type: 'password', password: PW, scrypt: FAST });
    v = addSlot(v, { type: 'password', password: PW }, { type: 'prf', credentialId: 'cred-1', prfOutput: prf });
    expect(v.slots).toHaveLength(2);
    const s = unlockVault(v, { type: 'prf', credentialId: 'cred-1', prfOutput: prf });
    expect(s).toEqual({ mnemonic, passphrase: 'p' });
    expect(() => unlockVault(v, { type: 'prf', credentialId: 'cred-1', prfOutput: randomBytes(32) })).toThrow(VaultError);
    expect(() => unlockVault(v, { type: 'prf', credentialId: 'other', prfOutput: prf })).toThrow(VaultError);
  });

  it('can create with passkey only, and survives serialisation', () => {
    const prf = randomBytes(32);
    const v = parseVault(serializeVault(createVault({ mnemonic }, { type: 'prf', credentialId: 'c', prfOutput: prf })));
    expect(unlockVault(v, { type: 'prf', credentialId: 'c', prfOutput: prf }).mnemonic).toBe(mnemonic);
  });

  it('removes slots but never the last one', () => {
    const prf = randomBytes(32);
    let v = createVault({ mnemonic }, { type: 'password', password: PW, scrypt: FAST });
    v = addSlot(v, { type: 'password', password: PW }, { type: 'prf', credentialId: 'c', prfOutput: prf });
    const pwSlot = v.slots.find((s) => s.type === 'password')!;
    v = removeSlot(v, { type: 'prf', credentialId: 'c', prfOutput: prf }, pwSlot.id);
    expect(() => unlockVault(v, { type: 'password', password: PW })).toThrow(VaultError);
    expect(() => removeSlot(v, { type: 'prf', credentialId: 'c', prfOutput: prf }, v.slots[0]!.id)).toThrow(VaultError);
  });

  it('rejects malformed vaults', () => {
    expect(() => parseVault('{"v":2}')).toThrow(VaultError);
  });
});
