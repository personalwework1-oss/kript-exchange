import { describe, it, expect } from 'vitest';
import { formatAmount, parseAmount } from '../src/format';

describe('amount parsing (money-critical)', () => {
  it('parses dot and comma', () => {
    expect(parseAmount('1.5', 6)).toBe(1_500_000n);
    expect(parseAmount('1,5', 6)).toBe(1_500_000n);
    expect(parseAmount(' 25 ', 6)).toBe(25_000_000n);
    expect(parseAmount('0.000001', 6)).toBe(1n);
    expect(parseAmount('0.00000001', 8)).toBe(1n);
    expect(parseAmount('1.000000000000000001', 18)).toBe(10n ** 18n + 1n);
  });
  it('rejects garbage and too many decimals', () => {
    for (const s of ['', '.', '1.', '.5', '1e5', '-1', 'abc', '1.2.3', '0x10']) expect(parseAmount(s, 6)).toBeNull();
    expect(parseAmount('0.0000001', 6)).toBeNull();
  });
  it('formats and round-trips', () => {
    expect(formatAmount(1_500_000n, 6)).toBe('1,5');
    expect(formatAmount(1_234_567_890_000n, 6)).toBe('1 234 567,89');
    expect(formatAmount(0n, 6)).toBe('0');
    const v = 123_456_789n;
    expect(parseAmount(formatAmount(v, 6, 6).replace(/ /g, ''), 6)).toBe(v);
  });
});
