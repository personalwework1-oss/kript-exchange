import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { CoinIcon, Mono, Notice, TextTabs, Txt } from '../../components/ui';
import { SwapPanel } from '../../components/SwapPanel';
import { CandleChart } from '../../components/charts';
import { ALL_COINS, fetchCandles, useMarkets, type Candle } from '../../market/prices';
import { fmtCompactUsd, fmtPct, fmtPrice } from '../../format';
import { colors } from '../../theme';
import { swapPairsFor } from '../../wallet/swap';

type Tf = '1' | '7' | '30';
type Mode = 'market' | 'limit';
const TF: { value: Tf; label: string }[] = [{ value: '1', label: '1Д' }, { value: '7', label: '1Н' }, { value: '30', label: '1М' }];
const TRADABLE = ALL_COINS.filter((c) => swapPairsFor(c.symbol).length > 0);

export default function Trade() {
  const params = useLocalSearchParams<{ symbol?: string; side?: 'buy' | 'sell'; mode?: Mode }>();
  const coin = TRADABLE.find((c) => c.symbol === params.symbol) ?? TRADABLE.find((c) => c.symbol === 'ETH') ?? TRADABLE[0]!;
  const mode: Mode = params.mode === 'limit' ? 'limit' : 'market';
  const { data } = useMarkets();
  const m = data?.find((x) => x.coin.cgId === coin.cgId);
  const { width } = useWindowDimensions();
  const [tf, setTf] = useState<Tf>('1');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let alive = true;
    setCandles(null); setErr(null);
    fetchCandles(coin.cgId, Number(tf) as 1 | 7 | 30)
      .then((c) => alive && setCandles(c))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [coin.cgId, tf]);

  const up = (m?.change24h ?? 0) >= 0;
  const list = useMemo(() => TRADABLE.map((c) => ({ c, m: data?.find((x) => x.coin.cgId === c.cgId) })), [data]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingTop: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <TextTabs<Mode> value={mode} onChange={(v) => router.setParams({ mode: v })} size={17}
            options={[{ value: 'market', label: 'Обмен' }, { value: 'limit', label: 'Лимит' }]} />
          <Pressable onPress={() => router.push({ pathname: '/coin', params: { symbol: coin.symbol } })} accessibilityRole="button" accessibilityLabel="Подробный график" hitSlop={8}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.text2} strokeWidth={1.8} strokeLinecap="round"><Path d="M5 20V10" /><Path d="M12 20V4" /><Path d="M19 20v-7" /></Svg>
          </Pressable>
        </View>

        <Pressable onPress={() => setPicking((p) => !p)} accessibilityRole="button" accessibilityLabel="Выбрать пару"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Txt weight="heavy" style={{ fontSize: 19, letterSpacing: -0.3 }}>{coin.symbol}/USDT</Txt>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={colors.text2} strokeWidth={2.2} strokeLinecap="round"><Path d={picking ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></Svg>
          {m ? (
            <View style={{ height: 20, paddingHorizontal: 6, borderRadius: 4, justifyContent: 'center', backgroundColor: up ? colors.upSoft : colors.downSoft }}>
              <Mono bold style={{ fontSize: 12, color: up ? colors.up : colors.down }}>{fmtPct(m.change24h)}</Mono>
            </View>
          ) : null}
        </Pressable>

        {picking ? (
          <View style={{ marginTop: 8, borderRadius: 8, backgroundColor: colors.surface, paddingVertical: 4 }}>
            {list.map(({ c, m: cm }) => (
              <Pressable key={c.cgId} onPress={() => { setPicking(false); router.setParams({ symbol: c.symbol }); }} accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, paddingHorizontal: 12 }}>
                <CoinIcon glyph={c.glyph} color={c.color} size={22} />
                <Txt weight="bold" style={{ flex: 1 }}>{c.symbol}<Txt style={{ color: colors.muted, fontSize: 12 }}> /USDT</Txt></Txt>
                {cm ? <Mono style={{ fontSize: 13 }}>{fmtPrice(cm.price)}</Mono> : null}
                {cm ? <Mono style={{ width: 64, textAlign: 'right', fontSize: 12, color: cm.change24h >= 0 ? colors.up : colors.down }}>{fmtPct(cm.change24h)}</Mono> : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
          <View>
            <Mono bold style={{ fontSize: 22, color: up ? colors.up : colors.down }}>{m ? fmtPrice(m.price) : '—'}</Mono>
            <Txt style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{m ? `≈ $${fmtPrice(m.price)}` : ' '}</Txt>
          </View>
          {m ? (
            <View style={{ gap: 3, alignItems: 'flex-end' }}>
              {[['Макс. 24ч', fmtPrice(m.high24h)], ['Мин. 24ч', fmtPrice(m.low24h)], ['Объём', fmtCompactUsd(m.volume24h)]].map(([k, v]) => (
                <View key={k} style={{ flexDirection: 'row', gap: 10 }}>
                  <Txt style={{ fontSize: 11, color: colors.muted }}>{k}</Txt><Mono style={{ fontSize: 11 }}>{v}</Mono>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 4, marginTop: 10 }}>
          {TF.map((t) => (
            <Pressable key={t.value} onPress={() => setTf(t.value)} accessibilityRole="button" accessibilityState={{ selected: tf === t.value }}
              style={{ height: 22, paddingHorizontal: 10, borderRadius: 4, justifyContent: 'center', backgroundColor: tf === t.value ? colors.surface3 : colors.surface }}>
              <Txt weight={tf === t.value ? 'bold' : 'regular'} style={{ fontSize: 11, color: tf === t.value ? colors.text : colors.muted }}>{t.label}</Txt>
            </Pressable>
          ))}
        </View>
        <View style={{ height: 150, justifyContent: 'center', marginTop: 6 }}>
          {candles ? <CandleChart candles={candles} width={width - 32} height={150} maxCandles={40} axis />
            : err ? <Notice tone="error" text={`График недоступен: ${err}`} /> : <ActivityIndicator color={colors.brand} />}
        </View>

        <View style={{ marginTop: 14, borderTopWidth: 6, borderTopColor: colors.surface, marginHorizontal: -16, paddingHorizontal: 16, paddingTop: 14 }}>
          <SwapPanel key={`${coin.symbol}:${mode}:${params.side ?? ''}`} symbol={coin.symbol} marketPrice={m?.price} type={mode} initialSide={params.side === 'sell' ? 'sell' : 'buy'} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
