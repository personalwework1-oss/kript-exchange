import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { CHAINS, type ChainId } from '@kript/wallet-core';
import { CoinIcon, Mono, Notice, Txt } from '../../components/ui';
import { ALL_COINS, COINS, USDT_COIN } from '../../market/prices';
import { formatAmount, fmtPct, fmtUsd } from '../../format';
import { colors } from '../../theme';
import { networkLabel } from '../../wallet/networks';
import { TRUST_LABEL } from '../../wallet/tokens';
import { usePortfolio, type Valued } from '../../wallet/usePortfolio';

const NET_COLOR: Record<ChainId, string> = { bitcoin: '#F7931A', ethereum: '#627EEA', bsc: '#F0B90B', polygon: '#7B3FE4', solana: '#9945FF', tron: '#EB0029' };
const SMALL_USD = 1;

export default function Assets() {
  const { valued, hidden, total, pnl, pnlPct, loading, holdings, failed, visible, reload } = usePortfolio();
  const [refreshing, setRefreshing] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [hideSmall, setHideSmall] = useState(false);
  const [hideBal, setHideBal] = useState(false);
  const mask = (s: string) => (hideBal ? '••••' : s);

  const byNet = useMemo(() => {
    const m = new Map<ChainId, number>();
    for (const h of valued) if (h.usd) m.set(h.chain, (m.get(h.chain) ?? 0) + h.usd);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [valued]);

  const list = hideSmall ? valued.filter((h) => (h.usd ?? 0) >= SMALL_USD) : valued;

  const row = (h: Valued) => {
    const coin = h.symbol === 'USDT' ? USDT_COIN : (ALL_COINS.find((c) => c.cgId === h.cgId) ?? COINS.find((c) => c.symbol === h.symbol && !h.token));
    const warn = h.trust === 'suspicious' || h.trust === 'unverified';
    return (
      <Pressable key={h.key} onPress={() => router.push({ pathname: '/send', params: { chain: h.chain, token: h.token?.address ?? 'native' } })}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 56 }} accessibilityRole="button">
        <View>
          <CoinIcon glyph={coin?.glyph ?? h.symbol[0] ?? '?'} color={coin?.color ?? colors.surface2} size={30} />
          <View style={{ position: 'absolute', right: -2, bottom: -2, width: 13, height: 13, borderRadius: 7, backgroundColor: NET_COLOR[h.chain], borderWidth: 2, borderColor: colors.bg }} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" style={{ fontSize: 15 }}>{h.symbol}</Txt>
          <Txt style={{ fontSize: 11, marginTop: 2, color: warn ? (h.trust === 'suspicious' ? colors.down : colors.warn) : colors.muted }}>
            {networkLabel(h.chain)}{h.trust !== 'verified' ? ` · ${TRUST_LABEL[h.trust]}` : ''}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Mono style={{ fontSize: 15 }}>{mask(formatAmount(h.amount, h.decimals))}</Mono>
          <Mono style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{h.usd !== undefined ? mask(fmtUsd(h.usd, 2)) : '—'}</Mono>
        </View>
      </Pressable>
    );
  };

  const btn = (t: string, go: () => void, primary = false) => (
    <Pressable key={t} onPress={go} accessibilityRole="button"
      style={{ flex: 1, height: 36, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? colors.brand : colors.surface2 }}>
      <Txt weight="bold" style={{ fontSize: 14, color: primary ? '#fff' : colors.text }}>{t}</Txt>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl tintColor={colors.brand} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
          <Txt weight="bold" style={{ fontSize: 17 }}>Активы</Txt>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Pressable onPress={() => router.push('/add-token')} accessibilityRole="button" accessibilityLabel="Добавить токен" hitSlop={8}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.text2} strokeWidth={1.8} strokeLinecap="round"><Path d="M12 5v14" /><Path d="M5 12h14" /></Svg>
            </Pressable>
            <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Настройки" hitSlop={8}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.text2} strokeWidth={1.8} strokeLinecap="round"><Circle cx={12} cy={12} r={3} /><Path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></Svg>
            </Pressable>
          </View>
        </View>

        <Pressable onPress={() => setHideBal((v) => !v)} accessibilityRole="button" accessibilityLabel={hideBal ? 'Показать баланс' : 'Скрыть баланс'} style={{ marginTop: 16 }}>
          <Txt style={{ fontSize: 13, color: colors.text2 }}>Оценочная стоимость · {hideBal ? 'показать' : 'скрыть'}</Txt>
        </Pressable>
        <Mono bold style={{ fontSize: 30, letterSpacing: -0.8, marginTop: 6 }}>
          {loading && !holdings.length ? '…' : mask(total.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
          <Txt weight="semibold" style={{ fontSize: 14, color: colors.text2 }}>  USD</Txt>
        </Mono>
        <Txt style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>
          PnL за сегодня <Txt weight="semibold" style={{ fontSize: 12, color: pnl >= 0 ? colors.up : colors.down }}>{mask(`${pnl >= 0 ? '+' : '−'}${fmtUsd(Math.abs(pnl), 2)} (${fmtPct(pnlPct)})`)}</Txt>
        </Txt>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          {btn('Получить', () => router.push('/receive'), true)}
          {btn('Отправить', () => router.push('/send'))}
          {btn('Обменять', () => router.push({ pathname: '/trade', params: { mode: 'market' } }))}
        </View>

        {byNet.length ? (
          <View style={{ marginTop: 16, borderRadius: 8, backgroundColor: colors.surface, padding: 12 }}>
            <Txt weight="bold" style={{ fontSize: 12 }}>Распределение по сетям</Txt>
            <View style={{ flexDirection: 'row', gap: 2, marginTop: 10, height: 6 }}>
              {byNet.map(([c, v]) => <View key={c} style={{ flex: v, backgroundColor: NET_COLOR[c] }} />)}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 6, marginTop: 10 }}>
              {byNet.map(([c, v]) => (
                <View key={c} style={{ width: '50%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: NET_COLOR[c] }} />
                  <Txt style={{ fontSize: 11, color: colors.text2, flex: 1 }}>{CHAINS[c].name}</Txt>
                  <Mono style={{ fontSize: 11 }}>{mask(fmtUsd(v, 2))}</Mono>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
          <Txt weight="bold" style={{ fontSize: 15 }}>Монеты</Txt>
          <Pressable onPress={() => setHideSmall((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: hideSmall }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 14, height: 14, borderRadius: 3, borderWidth: 1.5, borderColor: hideSmall ? colors.brand : colors.muted, backgroundColor: hideSmall ? colors.brand : 'transparent' }} />
            <Txt style={{ fontSize: 12, color: colors.text2 }}>Скрыть мелкие</Txt>
          </Pressable>
        </View>

        {failed.length ? <Notice tone="warn" text={`Не удалось обновить: ${failed.map((f) => CHAINS[f.chain].name).join(', ')}. Потяните вниз, чтобы повторить.`} /> : null}
        {!loading && !visible.length ? <View style={{ marginTop: 8 }}><Notice text="Пока пусто. Нажмите «Получить», чтобы увидеть свои адреса и пополнить кошелёк." /></View> : null}

        {list.map(row)}

        {hidden.length ? (
          <View style={{ gap: 10, marginTop: 10 }}>
            <Pressable onPress={() => setShowHidden((v) => !v)} accessibilityRole="button">
              <Txt style={{ color: colors.muted, fontSize: 13 }}>{showHidden ? 'Скрыть' : 'Показать'} неподтверждённые токены ({hidden.length})</Txt>
            </Pressable>
            {showHidden ? (
              <>
                <Notice tone="warn" text="Эти токены пришли на ваш адрес, но мы их не знаем. Мошенники рассылают фальшивые «USDT» и токены со ссылками на «сайты для обмена». Не переходите по ссылкам из названий токенов и не одобряйте их списание." />
                {hidden.map((h) => row({ ...h, usd: undefined }))}
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
