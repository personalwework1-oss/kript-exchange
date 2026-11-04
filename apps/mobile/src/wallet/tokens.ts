/**
 * Token handling in the app:
 *  - verified tokens = wallet-core registry, additionally checked ON-CHAIN once per session
 *    (decimals must match; symbol too where the chain stores it). A mismatch demotes the token to unverified.
 *  - discovered tokens (anything the wallet holds but we don't know) = unverified, hidden by default.
 *  - custom tokens added by the user by contract address = unverified but shown, marked "added by you".
 */
import * as SecureStore from 'expo-secure-store';
import { findToken, isImpostorSymbol, tokensOn, type ChainId, type TokenInfo2, type TokenMeta } from '@kript/wallet-core';
import { adapter } from './networks';
import { NETWORK } from '../config';

export interface CustomToken {
  chain: ChainId;
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
}

const K_CUSTOM = 'kript.customTokens';
/** Separate list while a decoy wallet is open, so the real wallet's tokens never show there. */
const K_CUSTOM_DECOY = 'kript.cache.t';
export const CUSTOM_TOKEN_KEYS = [K_CUSTOM, K_CUSTOM_DECOY];
let customKey = K_CUSTOM;
export function setTokenProfile(profile: 'real' | 'decoy') {
  customKey = profile === 'decoy' ? K_CUSTOM_DECOY : K_CUSTOM;
}

export async function loadCustomTokens(): Promise<CustomToken[]> {
  try {
    const raw = await SecureStore.getItemAsync(customKey);
    return raw ? (JSON.parse(raw) as CustomToken[]) : [];
  } catch {
    return [];
  }
}

export async function saveCustomTokens(list: CustomToken[]) {
  await SecureStore.setItemAsync(customKey, JSON.stringify(list));
}

/** Verified registry tokens for a chain (mainnet only — testnet addresses differ). */
export function registryTokens(chain: ChainId): TokenInfo2[] {
  return NETWORK === 'mainnet' ? tokensOn(chain) : [];
}

const metaCache = new Map<string, Promise<TokenMeta | null>>();

/** On-chain metadata, cached for the session. */
export function tokenMeta(chain: ChainId, address: string): Promise<TokenMeta | null> {
  const k = `${chain}:${address}`;
  let p = metaCache.get(k);
  if (!p) {
    p = adapter(chain).tokenMetadata(address).catch(() => null);
    metaCache.set(k, p);
  }
  return p;
}

/** Registry token confirmed on-chain? (decimals equal; symbol equal where available) */
export async function confirmOnChain(t: TokenInfo2): Promise<boolean> {
  const m = await tokenMeta(t.chain, t.address);
  if (!m) return false;
  if (m.decimals !== t.decimals) return false;
  if (m.symbol !== undefined && m.symbol.toUpperCase() !== t.symbol.toUpperCase()) return false;
  return true;
}

export type TrustLevel = 'verified' | 'custom' | 'unverified' | 'suspicious';

export function trustOf(chain: ChainId, address: string, symbol: string, custom: CustomToken[]): TrustLevel {
  if (findToken(chain, address)) return 'verified';
  if (isImpostorSymbol(chain, symbol, address)) return 'suspicious';
  if (custom.some((c) => c.chain === chain && c.address === address)) return 'custom';
  return 'unverified';
}

export const TRUST_LABEL: Record<TrustLevel, string> = {
  verified: 'Проверен',
  custom: 'Добавлен вами',
  unverified: 'Не проверен',
  suspicious: 'Возможная подделка',
};
