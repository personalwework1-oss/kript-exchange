import { describe, it, expect } from 'vitest';
import uniswap from '@uniswap/default-token-list' with { type: 'json' };
import { findToken, isImpostorSymbol, isValidTronAddress, TOKENS, USDT } from '../src/index.js';

const CHAIN_IDS: Record<string, number> = { ethereum: 1, bsc: 56, polygon: 137, solana: 501000101 };
const list = (uniswap as { tokens: Array<{ chainId: number; address: string; decimals: number; symbol: string }> }).tokens;

describe('token registry', () => {
  for (const tok of TOKENS.filter((x) => x.chain !== 'tron')) {
    it(`${tok.chain} ${tok.symbol} matches the Uniswap default token list`, () => {
      const id = CHAIN_IDS[tok.chain]!;
      const hit = list.find((x) => x.chainId === id && (tok.chain === 'solana' ? x.address === tok.address : x.address.toLowerCase() === tok.address.toLowerCase()));
      expect(hit, `${tok.symbol} not found at ${tok.address}`).toBeDefined();
      expect(hit!.decimals).toBe(tok.decimals);
      expect(hit!.symbol).toBe(tok.symbol);
    });
  }

  it('Tron entries are valid TRC20 addresses', () => {
    for (const tok of TOKENS.filter((x) => x.chain === 'tron')) expect(isValidTronAddress(tok.address)).toBe(true);
  });

  it('USDT entries equal the USDT constants', () => {
    for (const c of ['ethereum', 'bsc', 'polygon', 'tron', 'solana'] as const) {
      expect(findToken(c, USDT[c].address)?.decimals).toBe(USDT[c].decimals);
    }
  });

  it('no duplicates', () => {
    const keys = TOKENS.map((x) => `${x.chain}:${x.address.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('flags impostor symbols', () => {
    expect(isImpostorSymbol('tron', 'USDT', 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj')).toBe(true);
    expect(isImpostorSymbol('tron', 'U$DT', 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj')).toBe(false); // no exact match, still unverified
    expect(isImpostorSymbol('tron', 'USDT', USDT.tron.address)).toBe(false);
    expect(isImpostorSymbol('ethereum', 'COOLCAT', '0x0000000000000000000000000000000000000001')).toBe(false);
  });
});
