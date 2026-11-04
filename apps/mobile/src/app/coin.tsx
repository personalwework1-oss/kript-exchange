/** Coin page: price, 24h stats, candles with MA, info, buy/sell. */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { CHAINS, type ChainId } from '@kript/wallet-core';
import { Mono, Notice, TextTabs, Txt } from '../components/ui';
import { CandleChart, lastMA } from '../components/charts';
import { ALL_COINS, chainsOf, fetchCandles, useMarkets, type Candle } from '../market/prices';
import { fmtCompactUsd, fmtPct, fmtPrice } from '../format';
import { colors } from '../theme';
import { swapPairsFor } from '../wallet/swap';

type Tf = '1' | '7' | '30' | '90';
const TF: { value: Tf; label: string }[] = [{ value: '1', label: '1Д' }, { value: '7', label: '1Н' }, { value: '30', label: '1М' }, { value: '90', label: '3М' }];
const PROVIDER: Partial<Record<ChainId, string>> = { ethereum: '0x · CoW Protocol', bsc: '0x · CoW Protocol', polygon: '0x · CoW Protocol', solana: 'Jupiter', tron: 'SunSwap' };

export default function CoinScreen() {
  const { symbol } = useLocalSearchParams<{ symbol?: string }>();
  const coin = ALL_COINS.find((c) => c.symbol === symbol) ?? ALL_COINS[0]!;
  const { data } = useMarkets();
  const m = data?.find((x) => x.coin.cgId === coin.cgId);
  const { width } = useWindowDimensions();
  const [tf, setTf] = useState<Tf>('1');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'info' | 'about'>('info');

  useEffect(() => {
    let alive = true;
    setCandles(null); setErr(null);
    fetchCandles(coin.cgId, Number(tf) as 1 | 7 | 30 | 90)
      .then((c) => alive && setCandles(c))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [coin.cgId, tf]);

  const pairs = useMemo(() => swapPairsFor(coin.symbol), [coin.symbol]);
  const tradable = pairs.length > 0;
  const up = (m?.change24h ?? 0) >= 0;
  const pc = up ? colors.up : colors.down;
  const ma7 = candles ? lastMA(candles, 7) : undefined;
  const ma25 = candles ? lastMA(candles, 25) : undefined;
  const nets = chainsOf(coin);
  const providers = [...new Set(pairs.map((p) => PROVIDER[p.chain]).filter(Boolean))].join(' · ');

  const kv = (k: string, v: string) => (
    <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
      <Txt style={{ fontSize: 11, color: colors.muted }}>{k}</Txt><Mono style={{ fontSize: 11 }}>{v}</Mono>
    </View>
  );
  const info = (k: string, v: string) => (
    <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 5 }}>
      <Txt style={{ fontSize: 12, color: colors.muted }}>{k}</Txt><Txt weight="semibold" style={{ fontSize: 12, flexShrink: 1, textAlign: 'right' }}>{v}</Txt>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 4 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Назад" hitSlop={10}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={2} strokeLinecap="round"><Path d="m15 18-6-6 6-6" /></Svg>
        </Pressable>
        <Txt weight="heavy" style={{ fontSize: 18 }}>{coin.symbol}/USDT</Txt>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 16, paddingTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Mono bold style={{ fontSize: 30, color: pc, letterSpacing: -0.8 }}>{m ? fmtPrice(m.price) : '—'}</Mono>
            {m ? <Txt style={{ fontSize: 12, marginTop: 4 }}><Txt style={{ fontSize: 12, color: colors.text2 }}>${fmtPrice(m.price)} </Txt><Txt weight="semibold" style={{ fontSize: 12, color: pc }}>{fmtPct(m.change24h)}</Txt></Txt> : null}
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
              {[coin.name, 'Ключи у вас'].map((t) => (
                <View key={t} style={{ height: 20, paddingHorizontal: 6, borderRadius: 4, backgroundColor: colors.surface2, justifyContent: 'center' }}>
                  <Txt style={{ fontSize: 11, color: colors.text2 }}>{t}</Txt>
                </View>
              ))}
            </View>
          </View>
          {m ? <View style={{ width: 150, gap: 5, paddingTop: 4 }}>{kv('Макс. 24ч', fmtPrice(m.high24h))}{kv('Мин. 24ч', fmtPrice(m.low24h))}{kv('Объём 24ч', fmtCompactUsd(m.volume24h))}</View> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          {TF.map((t) => (
            <Pressable key={t.value} onPress={() => setTf(t.value)} accessibilityRole="button" accessibilityState={{ selected: tf === t.value }}>
              <Txt weight={tf === t.value ? 'bold' : 'regular'} style={{ fontSize: 13, color: tf === t.value ? colors.text : colors.muted }}>{t.label}</Txt>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 8 }}>
          {ma7 !== undefined ? <Txt style={{ fontSize: 10, color: colors.ma1 }}>MA(7): {fmtPrice(ma7)}</Txt> : null}
          {ma25 !== undefined ? <Txt style={{ fontSize: 10, color: colors.ma2 }}>MA(25): {fmtPrice(ma25)}</Txt> : null}
        </View>
        <View style={{ height: 230, justifyContent: 'center', paddingHorizontal: 16, paddingTop: 4 }}>
          {candles ? <CandleChart candles={candles} width={width - 32} height={226} ma={[{ period: 7, color: colors.ma1 }, { period: 25, color: colors.ma2 }]} axis />
            : err ? <Notice tone="error" text={`График недоступен: ${err}`} /> : <ActivityIndicator color={colors.brand} />}
        </View>

        <View style={{ marginTop: 12, borderTopWidth: 6, borderTopColor: colors.surface, paddingHorizontal: 16, paddingTop: 14 }}>
          <TextTabs value={tab} onChange={setTab} size={14} options={[{ value: 'info', label: 'Инфо' }, { value: 'about', label: 'О монете' }]} />
          <View style={{ marginTop: 6 }}>
            {tab === 'info' ? (
              <>
                {m?.marketCap ? info('Капитализация', fmtCompactUsd(m.marketCap)) : null}
                {info('Сети в кошельке', nets.length ? nets.map((c) => CHAINS[c].name).join(', ') : 'Только отслеживание цены')}
                {info('Обмен через', tradable ? providers || '—' : 'Пока недоступен')}
                {info('Хранение', 'Ваш кошелёк, ключи у вас')}
              </>
            ) : (
              <Txt style={{ fontSize: 13, color: colors.text2, lineHeight: 19, paddingVertical: 5 }}>
                {coin.name} ({coin.symbol}). Цены и график — по данным CoinGecko. Покупка и продажа идут напрямую из вашего кошелька через внешних провайдеров обмена; биржа не хранит ваши средства.
              </Txt>
            )}
          </View>
          {!tradable ? <View style={{ marginTop: 8 }}><Notice text={`Обмен ${coin.symbol} в кошельке пока недоступен — можно только следить за ценой${coin.chain ? ', получать и отправлять' : ''}.`} /></View> : null}
        </View>
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, borderTopWidth: 1, borderTopColor: colors.line }}>
        {(['buy', 'sell'] as const).map((side) => (
          <Pressable key={side} disabled={!tradable} accessibilityRole="button" accessibilityState={{ disabled: !tradable }}
            onPress={() => router.push({ pathname: '/trade', params: { symbol: coin.symbol, side } })}
            style={({ pressed }) => ({ flex: 1, height: 42, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: side === 'buy' ? colors.up : colors.down, opacity: !tradable ? 0.35 : pressed ? 0.85 : 1 })}>
            <Txt weight="bold" style={{ color: '#fff', fontSize: 15 }}>{side === 'buy' ? 'Купить' : 'Продать'}</Txt>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
