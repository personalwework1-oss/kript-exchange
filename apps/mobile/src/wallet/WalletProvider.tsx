/**
 * Wallet state for the whole app.
 *
 * Storage (all in the OS keychain/keystore via expo-secure-store, this device only):
 *   kript.vault     encrypted vault (seed phrase), see wallet-core/vault.ts
 *   kript.accounts  public addresses of the real wallet (not secret)
 *   kript.bio       random 32-byte secret, readable only after Face ID / fingerprint.
 *                   It unlocks a vault slot, so biometrics never see the seed phrase.
 *   kript.dev       random 32-byte device secret. Mixed into the PIN key, never backed up,
 *                   so a copied vault cannot be brute-forced with only 10^6 PINs off the phone.
 *   kript.pin       PIN attempt counter / pause (wallet-core/pin.ts)
 *   kript.cache.a   "second vault": the decoy wallet (own seed, PIN-only) — or, when no decoy
 *                   is set, a filler vault nobody can open. Both look the same in storage,
 *                   and every PIN entry is checked against the real AND this vault (same time).
 *   kript.cache.b   decoy-on marker (HMAC of the real seed) or random bytes.
 *
 * The seed phrase lives in memory only while unlocked and is dropped on lock /
 * after AUTO_LOCK_MS in background.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  addSlot,
  createVault,
  decoyMarker,
  deriveAccounts,
  derivePrivateKey,
  generateMnemonic,
  hasSlot,
  parseVault,
  pinDisabled,
  pinFailure,
  pinWaitMs,
  PIN_MAX_FAILURES,
  PIN_STATE_FRESH,
  randomMarker,
  replaceSlots,
  serializeVault,
  unlockVault,
  type DerivedAccounts,
  type KeyFamily,
  type PinState,
  type UnlockInput,
  type Vault,
} from '@kript/wallet-core';
import { AUTO_LOCK_MS, MOBILE_SCRYPT, NETWORK } from '../config';
import { CUSTOM_TOKEN_KEYS, setTokenProfile } from './tokens';

const K_VAULT = 'kript.vault';
const K_ACCOUNTS = 'kript.accounts';
const K_BIO = 'kript.bio';
const K_DEV = 'kript.dev';
const K_PIN = 'kript.pin';
const K_ALT = 'kript.cache.a';
const K_MARK = 'kript.cache.b';
const BIO_CREDENTIAL = 'device-biometric';

const STORE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

type Status = 'loading' | 'none' | 'locked' | 'unlocked';
/** 'decoy' = opened with the decoy PIN. Never shown anywhere in the UI. */
type Mode = 'real' | 'decoy';

/** Proof of who you are for sensitive settings: the password or the current PIN. */
export type Auth = { password: string } | { pin: string };

export class PinError extends Error {
  constructor(
    public kind: 'wrong' | 'wait' | 'disabled',
    public waitMs = 0,
    public attemptsLeft = 0,
  ) {
    super(kind === 'disabled' ? 'PIN отключён' : kind === 'wait' ? 'Подождите' : 'Неверный PIN');
  }
}

interface WalletCtx {
  status: Status;
  accounts: DerivedAccounts | null;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  pinEnabled: boolean;
  pinState: PinState;
  createWallet(mnemonic: string, password: string, opts: { biometric: boolean; pin?: string }): Promise<void>;
  unlockWithPassword(password: string): Promise<void>;
  unlockWithBiometric(): Promise<void>;
  /** Throws PinError. Opens the real wallet or — with the decoy PIN — the decoy wallet. */
  unlockWithPin(pin: string): Promise<void>;
  lock(): void;
  deleteWallet(): Promise<void>;
  /** Returns the seed phrase of the wallet that is open now (for the "show seed" screen). */
  revealMnemonic(auth: Auth): Promise<string>;
  /** Sets, changes (pin) or removes (null) the unlock PIN. Requires the password. */
  setPin(password: string, pin: string | null): Promise<void>;
  /** null = unknown (decoy mode: always reported as "not set"). */
  decoyEnabled: boolean | null;
  /** Sets (pin) or removes (null) the decoy PIN. Requires the password. */
  setDecoyPin(password: string, pin: string | null): Promise<void>;
  /**
   * Runs `fn` with a private key and wipes the key afterwards. Requires an unlocked wallet;
   * asks for biometrics again if enabled (confirmation of every transfer).
   */
  withPrivateKey<T>(family: KeyFamily, fn: (key: Uint8Array) => Promise<T>): Promise<T>;
}

const Ctx = createContext<WalletCtx | null>(null);

/** Yield to the UI so spinners render before CPU-heavy scrypt runs. */
const nextFrame = () => new Promise((r) => setTimeout(r, 30));

function bytesToB64(b: Uint8Array) {
  return Buffer.from(b).toString('base64');
}
function b64ToBytes(s: string) {
  return new Uint8Array(Buffer.from(s, 'base64'));
}
function random32() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}
function randomPin() {
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  return String(r[0]! % 1_000_000).padStart(6, '0');
}

const get = (k: string) => SecureStore.getItemAsync(k, STORE_OPTS);
const put = (k: string, v: string) => SecureStore.setItemAsync(k, v, STORE_OPTS);
const del = (k: string) => SecureStore.deleteItemAsync(k, STORE_OPTS);

/** A PIN-only vault with a random seed that nobody can open (unknown PIN + throwaway device secret). */
function fillerVault(): Vault {
  return createVault({ mnemonic: generateMnemonic() }, { type: 'pin', pin: randomPin(), deviceSecret: random32() });
}

function tryUnlock(v: Vault | null, input: UnlockInput): string | null {
  if (!v) return null;
  try {
    return unlockVault(v, input).mnemonic;
  } catch {
    return null;
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [accounts, setAccounts] = useState<DerivedAccounts | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinState, setPinState] = useState<PinState>(PIN_STATE_FRESH);
  const [decoyOn, setDecoyOn] = useState(false);
  const [mode, setMode] = useState<Mode>('real');
  const mnemonicRef = useRef<string | null>(null);
  const modeRef = useRef<Mode>('real');
  const bgSince = useRef<number | null>(null);

  // Initial load
  useEffect(() => {
    (async () => {
      const [vault, pinRaw, hw, enrolled] = await Promise.all([
        get(K_VAULT),
        get(K_PIN),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      setBiometricAvailable(hw && enrolled);
      if (!vault) return setStatus('none');
      const v = parseVault(vault);
      setBiometricEnabled(v.slots.some((s) => s.type === 'prf' && s.credentialId === BIO_CREDENTIAL));
      setPinEnabled(hasSlot(v, 'pin'));
      if (pinRaw) setPinState(JSON.parse(pinRaw));
      setStatus('locked');
    })().catch(() => setStatus('none'));
  }, []);

  const lock = useCallback(() => {
    mnemonicRef.current = null;
    modeRef.current = 'real';
    setMode('real');
    setTokenProfile('real');
    setAccounts(null);
    setStatus((s) => (s === 'unlocked' ? 'locked' : s));
  }, []);

  // Auto-lock after time in background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        if (bgSince.current && Date.now() - bgSince.current > AUTO_LOCK_MS) lock();
        bgSince.current = null;
      } else if (bgSince.current === null) {
        bgSince.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [lock]);

  const loadVault = async (): Promise<Vault> => {
    const raw = await get(K_VAULT);
    if (!raw) throw new Error('Кошелёк не найден');
    return parseVault(raw);
  };
  const loadAlt = async (): Promise<Vault | null> => {
    const raw = await get(K_ALT);
    return raw ? parseVault(raw) : null;
  };
  const deviceSecret = async (create = false): Promise<Uint8Array> => {
    const raw = await get(K_DEV);
    if (raw) return b64ToBytes(raw);
    if (!create) throw new Error('Нет секрета устройства');
    const s = random32();
    await put(K_DEV, bytesToB64(s));
    return s;
  };

  const savePinState = async (s: PinState) => {
    setPinState(s);
    await put(K_PIN, JSON.stringify(s));
  };

  const finishUnlock = async (mnemonic: string, m: Mode) => {
    mnemonicRef.current = mnemonic;
    modeRef.current = m;
    setMode(m);
    setTokenProfile(m);
    const acc = deriveAccounts(mnemonic, { bitcoinNetwork: NETWORK });
    if (m === 'real') {
      await put(K_ACCOUNTS, JSON.stringify(acc));
      const mark = await get(K_MARK);
      setDecoyOn(mark === decoyMarker(mnemonic));
    }
    setAccounts(acc);
    setStatus('unlocked');
    return acc;
  };

  /** Password / biometrics prove the owner: they also clear the PIN attempt counter. */
  const resetPinCounter = async () => {
    const raw = await get(K_PIN);
    if (raw && (JSON.parse(raw) as PinState).failures > 0) await savePinState(PIN_STATE_FRESH);
  };

  /**
   * Checks a PIN against the real vault and the second vault. Both are always tried,
   * so the time taken doesn't reveal which (if any) matched. Applies the attempt policy.
   */
  const checkPin = async (pin: string): Promise<{ mnemonic: string; mode: Mode }> => {
    const raw = await get(K_PIN);
    const st: PinState = raw ? JSON.parse(raw) : PIN_STATE_FRESH;
    if (pinDisabled(st)) throw new PinError('disabled');
    const wait = pinWaitMs(st, Date.now());
    if (wait > 0) throw new PinError('wait', wait);
    const [real, alt, dev] = await Promise.all([loadVault(), loadAlt(), deviceSecret()]);
    await nextFrame();
    const input: UnlockInput = { type: 'pin', pin, deviceSecret: dev };
    const r = hasSlot(real, 'pin') ? tryUnlock(real, input) : null;
    const d = tryUnlock(alt, input);
    if (r || d) {
      if (st.failures > 0) await savePinState(PIN_STATE_FRESH);
      return r ? { mnemonic: r, mode: 'real' } : { mnemonic: d!, mode: 'decoy' };
    }
    const next = pinFailure(st, Date.now());
    await savePinState(next);
    if (pinDisabled(next)) throw new PinError('disabled');
    throw new PinError('wrong', pinWaitMs(next, Date.now()), PIN_MAX_FAILURES - next.failures);
  };

  /** Password check against the real vault. In decoy mode this always fails, like a wrong password. */
  const checkPassword = async (password: string): Promise<{ vault: Vault; mnemonic: string }> => {
    if (modeRef.current === 'decoy') {
      await nextFrame();
      throw new Error('Неверный пароль');
    }
    const vault = await loadVault();
    await nextFrame();
    try {
      return { vault, mnemonic: unlockVault(vault, { type: 'password', password }).mnemonic };
    } catch {
      throw new Error('Неверный пароль');
    }
  };

  const writeDecoy = async (realMnemonic: string, alt: Vault | null) => {
    await put(K_ALT, serializeVault(alt ?? fillerVault()));
    await put(K_MARK, alt ? decoyMarker(realMnemonic) : randomMarker());
    setDecoyOn(!!alt);
  };

  const createWallet = useCallback(async (mnemonic: string, password: string, opts: { biometric: boolean; pin?: string }) => {
    await nextFrame();
    let vault = createVault({ mnemonic }, { type: 'password', password, scrypt: MOBILE_SCRYPT });
    const unlock: UnlockInput = { type: 'password', password };
    if (opts.biometric) {
      const secret = random32();
      vault = addSlot(vault, unlock, { type: 'prf', credentialId: BIO_CREDENTIAL, prfOutput: secret });
      await SecureStore.setItemAsync(K_BIO, bytesToB64(secret), {
        ...STORE_OPTS,
        requireAuthentication: true,
        authenticationPrompt: 'Включить вход по биометрии',
      });
      secret.fill(0);
    }
    if (opts.pin) {
      const dev = await deviceSecret(true);
      vault = addSlot(vault, unlock, { type: 'pin', pin: opts.pin, deviceSecret: dev });
      await writeDecoy(mnemonic, null);
      await savePinState(PIN_STATE_FRESH);
    }
    await put(K_VAULT, serializeVault(vault));
    setBiometricEnabled(opts.biometric);
    setPinEnabled(!!opts.pin);
    await finishUnlock(mnemonic, 'real');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const unlockWithPassword = useCallback(async (password: string) => {
    const v = await loadVault();
    await nextFrame();
    const m = unlockVault(v, { type: 'password', password }).mnemonic;
    await resetPinCounter();
    await finishUnlock(m, 'real');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const readBioSecret = async (prompt: string) => {
    const b64 = await SecureStore.getItemAsync(K_BIO, { ...STORE_OPTS, requireAuthentication: true, authenticationPrompt: prompt });
    if (!b64) throw new Error('Биометрия не настроена');
    return b64ToBytes(b64);
  };

  const unlockWithBiometric = useCallback(async () => {
    const v = await loadVault();
    const secret = await readBioSecret('Войти в кошелёк');
    let m: string;
    try {
      m = unlockVault(v, { type: 'prf', credentialId: BIO_CREDENTIAL, prfOutput: secret }).mnemonic;
    } finally {
      secret.fill(0);
    }
    await resetPinCounter();
    await finishUnlock(m, 'real');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const unlockWithPin = useCallback(async (pin: string) => {
    const r = await checkPin(pin);
    await finishUnlock(r.mnemonic, r.mode);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const revealMnemonic = useCallback(async (auth: Auth) => {
    if ('pin' in auth) {
      const r = await checkPin(auth.pin);
      // The PIN must belong to the wallet that is open now.
      if (r.mode !== modeRef.current) throw new PinError('wrong');
      return r.mnemonic;
    }
    return (await checkPassword(auth.password)).mnemonic;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setPin = useCallback(async (password: string, pin: string | null) => {
    const { vault, mnemonic } = await checkPassword(password);
    const unlock: UnlockInput = { type: 'password', password };
    if (pin === null) {
      await put(K_VAULT, serializeVault(replaceSlots(vault, unlock, 'pin', null)));
      await Promise.all([K_ALT, K_MARK, K_PIN].map(del)); // no PIN → no decoy either
      setPinEnabled(false);
      setDecoyOn(false);
      setPinState(PIN_STATE_FRESH);
      return;
    }
    const dev = await deviceSecret(true);
    const alt = await loadAlt();
    if (tryUnlock(alt, { type: 'pin', pin, deviceSecret: dev })) throw new Error('Этот PIN уже используется как ложный');
    await put(K_VAULT, serializeVault(replaceSlots(vault, unlock, 'pin', { type: 'pin', pin, deviceSecret: dev })));
    if (!alt) await writeDecoy(mnemonic, null);
    await savePinState(PIN_STATE_FRESH);
    setPinEnabled(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setDecoyPin = useCallback(async (password: string, pin: string | null) => {
    const { vault, mnemonic } = await checkPassword(password);
    if (!hasSlot(vault, 'pin')) throw new Error('Сначала включите обычный PIN');
    if (pin === null) return writeDecoy(mnemonic, null);
    const dev = await deviceSecret();
    if (tryUnlock(vault, { type: 'pin', pin, deviceSecret: dev })) throw new Error('Ложный PIN должен отличаться от настоящего');
    const decoy = createVault({ mnemonic: generateMnemonic(12) }, { type: 'pin', pin, deviceSecret: dev });
    await writeDecoy(mnemonic, decoy);
    await put(CUSTOM_TOKEN_KEYS[1]!, '[]');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const withPrivateKey = useCallback(
    async <T,>(family: KeyFamily, fn: (key: Uint8Array) => Promise<T>): Promise<T> => {
      const m = mnemonicRef.current;
      if (!m) throw new Error('Кошелёк заблокирован');
      if (biometricEnabled) {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Подтвердите операцию' });
        if (!r.success) throw new Error('Операция отменена');
      }
      const key = derivePrivateKey(m, family, { bitcoinNetwork: NETWORK });
      try {
        return await fn(key);
      } finally {
        key.fill(0);
      }
    },
    [biometricEnabled],
  );

  const deleteWallet = useCallback(async () => {
    mnemonicRef.current = null;
    modeRef.current = 'real';
    setMode('real');
    setTokenProfile('real');
    await Promise.all([K_VAULT, K_ACCOUNTS, K_BIO, K_DEV, K_PIN, K_ALT, K_MARK, ...CUSTOM_TOKEN_KEYS].map(del));
    setAccounts(null);
    setBiometricEnabled(false);
    setPinEnabled(false);
    setDecoyOn(false);
    setPinState(PIN_STATE_FRESH);
    setStatus('none');
  }, []);

  const decoyEnabled = mode === 'decoy' ? false : status === 'unlocked' ? decoyOn : null;

  const value = useMemo<WalletCtx>(
    () => ({
      status, accounts, biometricEnabled, biometricAvailable, pinEnabled, pinState, decoyEnabled,
      createWallet, unlockWithPassword, unlockWithBiometric, unlockWithPin, lock, deleteWallet,
      revealMnemonic, setPin, setDecoyPin, withPrivateKey,
    }),
    [status, accounts, biometricEnabled, biometricAvailable, pinEnabled, pinState, decoyEnabled,
      createWallet, unlockWithPassword, unlockWithBiometric, unlockWithPin, lock, deleteWallet,
      revealMnemonic, setPin, setDecoyPin, withPrivateKey],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWallet outside WalletProvider');
  return c;
}
