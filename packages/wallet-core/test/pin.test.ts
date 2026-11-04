import { describe, it, expect } from 'vitest';
import { randomBytes } from '@noble/hashes/utils.js';
import {
  addSlot, createVault, decoyMarker, randomMarker, generateMnemonic, hasSlot, isWeakPin, parseVault, pinDisabled, pinFailure, pinLockoutMs, pinWaitMs,
  PIN_MAX_FAILURES, PIN_STATE_FRESH, replaceSlots, serializeVault, unlockVault, VaultError,
} from '../src/index.js';

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PW = 'correct horse battery';

describe('PIN vault slot', () => {
  const mnemonic = generateMnemonic();
  const dev = randomBytes(32);

  function withPin(pin = '493817') {
    const v = createVault({ mnemonic }, { type: 'password', password: PW, scrypt: FAST });
    return addSlot(v, { type: 'password', password: PW }, { type: 'pin', pin, deviceSecret: dev, scrypt: FAST });
  }

  it('unlocks with the right PIN on the same device', () => {
    const v = parseVault(serializeVault(withPin()));
    expect(hasSlot(v, 'pin')).toBe(true);
    expect(unlockVault(v, { type: 'pin', pin: '493817', deviceSecret: dev }).mnemonic).toBe(mnemonic);
  });

  it('wrong PIN fails', () => {
    expect(() => unlockVault(withPin(), { type: 'pin', pin: '493818', deviceSecret: dev })).toThrow(VaultError);
  });

  it('right PIN on another device (no device secret) fails — the vault copy cannot be brute-forced elsewhere', () => {
    expect(() => unlockVault(withPin(), { type: 'pin', pin: '493817', deviceSecret: randomBytes(32) })).toThrow(VaultError);
  });

  it('accepts only 6 digits and a 32-byte device secret', () => {
    const v = createVault({ mnemonic }, { type: 'password', password: PW, scrypt: FAST });
    for (const pin of ['12345', '1234567', '12a456', '']) {
      expect(() => addSlot(v, { type: 'password', password: PW }, { type: 'pin', pin, deviceSecret: dev, scrypt: FAST })).toThrow(VaultError);
    }
    expect(() => addSlot(v, { type: 'password', password: PW }, { type: 'pin', pin: '493817', deviceSecret: randomBytes(16), scrypt: FAST })).toThrow(VaultError);
  });

  it('change PIN: old stops working, password still works; PIN can be removed', () => {
    let v = withPin('493817');
    v = replaceSlots(v, { type: 'password', password: PW }, 'pin', { type: 'pin', pin: '820461', deviceSecret: dev, scrypt: FAST });
    expect(v.slots.filter((s) => s.type === 'pin')).toHaveLength(1);
    expect(() => unlockVault(v, { type: 'pin', pin: '493817', deviceSecret: dev })).toThrow(VaultError);
    expect(unlockVault(v, { type: 'pin', pin: '820461', deviceSecret: dev }).mnemonic).toBe(mnemonic);
    v = replaceSlots(v, { type: 'password', password: PW }, 'pin', null);
    expect(hasSlot(v, 'pin')).toBe(false);
    expect(unlockVault(v, { type: 'password', password: PW }).mnemonic).toBe(mnemonic);
  });

  it('a PIN-only vault (decoy) works and cannot lose its last slot', () => {
    const decoy = createVault({ mnemonic: generateMnemonic() }, { type: 'pin', pin: '730194', deviceSecret: dev, scrypt: FAST });
    expect(unlockVault(decoy, { type: 'pin', pin: '730194', deviceSecret: dev }).mnemonic).not.toBe(mnemonic);
    expect(() => replaceSlots(decoy, { type: 'pin', pin: '730194', deviceSecret: dev }, 'pin', null)).toThrow(VaultError);
  });
});

describe('PIN attempt policy', () => {
  it('no delay for the first 4 failures, then a growing pause', () => {
    for (let f = 0; f < 5; f++) expect(pinLockoutMs(f)).toBe(0);
    expect(pinLockoutMs(5)).toBe(30_000);
    expect(pinLockoutMs(6)).toBe(60_000);
    expect(pinLockoutMs(9)).toBe(3_600_000);
  });

  it('counts failures, blocks for the pause, disables after 10', () => {
    let s = PIN_STATE_FRESH;
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) s = pinFailure(s, t0);
    expect(pinWaitMs(s, t0)).toBe(0);
    s = pinFailure(s, t0);
    expect(pinWaitMs(s, t0)).toBe(30_000);
    expect(pinWaitMs(s, t0 + 30_000)).toBe(0);
    while (s.failures < PIN_MAX_FAILURES) s = pinFailure(s, t0);
    expect(pinDisabled(s)).toBe(true);
  });

  it('refuses guessable PINs', () => {
    for (const p of ['000000', '111111', '123456', '654321', '890123', '121212', '123123', '112233', '12345', 'abcdef']) expect(isWeakPin(p)).toBe(true);
    for (const p of ['493817', '820461', '730194']) expect(isWeakPin(p)).toBe(false);
  });
});

describe('decoy marker', () => {
  it('is deterministic for the seed and looks like random hex', () => {
    const m = generateMnemonic();
    expect(decoyMarker(m)).toBe(decoyMarker(m));
    expect(decoyMarker(m)).not.toBe(decoyMarker(generateMnemonic()));
    expect(decoyMarker(m)).toMatch(/^[0-9a-f]{64}$/);
    expect(randomMarker()).toMatch(/^[0-9a-f]{64}$/);
  });
});
