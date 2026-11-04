import React, { useMemo } from 'react';
import Svg, { Line, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '../theme';
import type { Candle } from '../market/prices';

export function Sparkline({ data, width = 90, height = 26, up }: { data: number[]; width?: number; height?: number; up: boolean }) {
  const points = useMemo(() => {
    if (data.length < 2) return '';
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    return data.map((v, i) => `${(i / (data.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`).join(' ');
  }, [data, width, height]);
  return (
    <Svg width={width} height={height}>
      {points ? <Polyline points={points} fill="none" stroke={up ? colors.up : colors.down} strokeWidth={2} strokeLinejoin="round" /> : null}
    </Svg>
  );
}

/** Candlestick chart with optional MA lines and a right-hand price axis (exchange style). */
export function CandleChart({ candles, width, height = 200, maxCandles = 48, ma = [], axis = false }: {
  candles: Candle[]; width: number; height?: number; maxCandles?: number; ma?: { period: number; color: string }[]; axis?: boolean;
}) {
  const view = candles.slice(-maxCandles);
  const { lo, hi } = useMemo(() => ({
    lo: Math.min(...view.map((c) => c.l)),
    hi: Math.max(...view.map((c) => c.h)),
  }), [view]);
  if (!view.length) return null;
  const axisW = axis ? 52 : 0;
  const plotW = width - axisW;
  const pad = 6;
  const y = (v: number) => pad + ((hi - v) / (hi - lo || 1)) * (height - pad * 2);
  const step = plotW / view.length;
  const bodyW = Math.max(2, step * 0.66);
  const last = view[view.length - 1]!;
  const lastCol = last.c >= last.o ? colors.up : colors.down;
  // MA over the full series so the first visible points are already averaged.
  const off = candles.length - view.length;
  const maPath = (period: number) => view.map((_, i) => {
    const end = off + i + 1;
    const slice = candles.slice(Math.max(0, end - period), end);
    const avg = slice.reduce((a, c) => a + c.c, 0) / slice.length;
    return `${i === 0 ? 'M' : 'L'}${(i * step + step / 2).toFixed(1)},${y(avg).toFixed(1)}`;
  }).join(' ');
  const fmt = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: v >= 100 ? 1 : 4 });
  return (
    <Svg width={width} height={height} accessibilityLabel="Свечной график цены">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const yy = pad + f * (height - pad * 2);
        return (
          <React.Fragment key={f}>
            <Line x1={0} x2={plotW} y1={yy} y2={yy} stroke="#ffffff" strokeOpacity={0.05} strokeWidth={1} />
            {axis ? <SvgText x={width - 2} y={yy + 4} fontSize={10} fill={colors.muted} textAnchor="end">{fmt(hi - f * (hi - lo))}</SvgText> : null}
          </React.Fragment>
        );
      })}
      {view.map((c, i) => {
        const up = c.c >= c.o;
        const col = up ? colors.up : colors.down;
        const cx = i * step + step / 2;
        const top = y(Math.max(c.o, c.c));
        const h = Math.max(1.2, Math.abs(y(c.o) - y(c.c)));
        return (
          <React.Fragment key={c.t}>
            <Line x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1} />
            <Rect x={cx - bodyW / 2} y={top} width={bodyW} height={h} fill={col} />
          </React.Fragment>
        );
      })}
      {ma.map((m) => <Path key={m.period} d={maPath(m.period)} fill="none" stroke={m.color} strokeWidth={1.1} />)}
      <Line x1={0} x2={plotW} y1={y(last.c)} y2={y(last.c)} stroke={lastCol} strokeDasharray="2 3" strokeWidth={1} />
      {axis ? (
        <>
          <Rect x={plotW} y={y(last.c) - 9} width={axisW} height={18} rx={2} fill={lastCol} />
          <SvgText x={plotW + axisW / 2} y={y(last.c) + 4} fontSize={10} fontWeight="700" fill="#fff" textAnchor="middle">{fmt(last.c)}</SvgText>
        </>
      ) : null}
    </Svg>
  );
}

/** Moving average of closes ending at the last candle. */
export function lastMA(candles: Candle[], period: number): number | undefined {
  if (!candles.length) return undefined;
  const s = candles.slice(-period);
  return s.reduce((a, c) => a + c.c, 0) / s.length;
}
