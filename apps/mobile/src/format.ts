/** Parse a user-typed decimal ("1,5" or "1.5") into base units. Returns null if invalid. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const s = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.') as [string, string?];
  if (frac.length > decimals) return null;
  return BigInt(int) * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/** Base units -> decimal string, trimmed to `maxFrac` digits, with Russian-style separators. */
export function formatAmount(value: bigint, decimals: number, maxFrac = 6): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const int = v / base;
  let frac = (v % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  const intStr = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '−' : '') + intStr + (frac ? ',' + frac : '');
}

export function toNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

export function fmtUsd(n: number, frac?: number): string {
  const f = frac ?? (n >= 1000 ? 2 : n >= 1 ? 2 : n >= 0.01 ? 4 : 6);
  return '$' + n.toLocaleString('ru-RU', { minimumFractionDigits: f, maximumFractionDigits: f });
}

export function fmtPrice(n: number): string {
  const f = n >= 1000 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 4 : 6;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: f, maximumFractionDigits: f });
}

export function fmtPct(n: number): string {
  const s = Math.abs(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n >= 0 ? '+' : '−') + s + '%';
}

export function fmtCompactUsd(n: number): string {
  if (n >= 1e9) return '$' + (n / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' млрд';
  if (n >= 1e6) return '$' + (n / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' млн';
  return fmtUsd(n, 0);
}

export function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
