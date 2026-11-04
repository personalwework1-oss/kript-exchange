import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Mono, Notice, TextTabs, Txt } from '../../components/ui';
import { MarketHeader, MarketRow, SearchBar } from '../../components/market';
import { fmtPct, fmtUsd } from '../../format';
import { colors } from '../../theme';
import { usePortfolio } from '../../wallet/usePortfolio';

type Tab = 'hot' | 'gainers' | 'losers';

const ICONS: Record<string, React.ReactNode> = {
  receive: <><Path d="M12 5v14" /><Path d="m5 12 7 7 7-7" /></>,
  send: <><Path d="M12 19V5" /><Path d="m5 12 7-7 7 7" /></>,
  swap: <><Path d="M7 4v16" /><Path d="m3 8 4-4 4 4" /><Path d="M17 20V4" /><Path d="m21 16-4 4-4-4" /></>,
  limit: <><Circle cx={12} cy={12} r={9} /><Path d="M12 7v5l3 2" /></>,
  token: <><Path d="M12 5v14" /><Path d="M5 12h14" /></>,
  shield: <Path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />,
  history: <><Path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><Path d="M3 3v5h5" /><Path d="M12 7v5l3 2" /></>,
  eye: <><Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12" /><Circle cx={12} cy={12} r={3} /></>,
  eyeOff: <><Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12" /><Path d="M3 3l18 18" /></>,
  more: <><Rect x={3} y={3} width={7} height={7} rx={1.5} /><Rect x={14} y={3} width={7} height={7} rx={1.5} /><Rect x={3} y={14} width={7} height={7} rx={1.5} /><Rect x={14} y={14} width={7} height={7} rx={1.5} /></>,
};
const Icon = ({ name, size = 24, color = colors.text }: { name: string; size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</Svg>
);

const ACTIONS: { icon: string; label: string; go: () => void }[] = [
  { icon: 'receive', label: 'Получить', go: () => router.push('/receive') },
  { icon: 'send', label: 'Отправить', go: () => router.push('/send') },
  { icon: 'swap', label: 'Обмен', go: () => router.push({ pathname: '/trade', params: { mode: 'market' } }) },
  { icon: 'limit', label: 'Лимит', go: () => router.push({ pathname: '/trade', params: { mode: 'limit' } }) },
  { icon: 'token', label: 'Токен', go: () => router.push('/add-token') },
  { icon: 'shield', label: 'Защита', go: () => router.push('/settings') },
  { icon: 'history', label: 'История', go: () => router.push('/orders') },
  { icon: 'more', label: 'Ещё', go: () => router.push('/settings') },
];

export default function Home() {
  const { markets, total, pnl, pnlPct, loading, holdings, reload } = usePortfolio();
  const [hide, setHide] = useState(false);
  const [tab, setTab] = useState<Tab>('hot');
  const [refreshing, setRefreshing] = useState(false);

  const rows = useMemo(() => {
    const r = (markets ?? []).filter((m) => m.coin.symbol !== 'USDT');
    if (tab === 'gainers') return [...r].sort((a, b) => b.change24h - a.change24h).slice(0, 6);
    if (tab === 'losers') return [...r].sort((a, b) => a.change24h - b.change24h).slice(0, 6);
    return [...r].sort((a, b) => b.volume24h - a.volume24h).slice(0, 6);
  }, [markets, tab]);

  const mask = (s: string) => (hide ? '••••••' : s);
  const totalTxt = loading && !holdings.length ? '…' : total.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl tintColor={colors.brand} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 }}>
          <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Настройки"
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Txt weight="heavy" style={{ color: '#fff' }}>K</Txt>
          </Pressable>
          <SearchBar onPress={() => router.push('/markets')} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 18 }}>
          <View style={{ flex: 1 }}>
            <Pressable onPress={() => setHide((h) => !h)} accessibilityRole="button" accessibilityLabel={hide ? 'Показать баланс' : 'Скрыть баланс'}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Txt style={{ fontSize: 13, color: colors.text2 }}>Общий баланс</Txt>
              <Icon name={hide ? 'eyeOff' : 'eye'} size={15} color={colors.muted} />
            </Pressable>
            <Txt style={{ marginTop: 6 }}>
              <Mono bold style={{ fontSize: 30, letterSpacing: -0.8 }}>{mask(totalTxt)}</Mono>
              <Txt weight="semibold" style={{ fontSize: 14, color: colors.text2 }}>  USD</Txt>
            </Txt>
            <Txt style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
              PnL сегодня <Txt style={{ fontSize: 12, color: pnl >= 0 ? colors.up : colors.down }}>{mask(`${pnl >= 0 ? '+' : '−'}${fmtUsd(Math.abs(pnl), 2)} (${fmtPct(pnlPct)})`)}</Txt>
            </Txt>
          </View>
          <Pressable onPress={() => router.push('/receive')} accessibilityRole="button"
            style={{ height: 34, paddingHorizontal: 16, borderRadius: 6, backgroundColor: colors.brand, justifyContent: 'center' }}>
            <Txt weight="bold" style={{ color: '#fff', fontSize: 14 }}>Пополнить</Txt>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16, marginTop: 20 }}>
          {ACTIONS.map((a) => (
            <Pressable key={a.label} onPress={a.go} accessibilityRole="button" style={{ width: '25%', alignItems: 'center', gap: 7 }}>
              <Icon name={a.icon} />
              <Txt style={{ fontSize: 12, color: colors.text2 }}>{a.label}</Txt>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => router.push('/decoy')} accessibilityRole="button"
          style={{ marginTop: 18, height: 36, borderRadius: 6, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10 }}>
          <Txt style={{ color: colors.brand }}>◆</Txt>
          <Txt style={{ flex: 1, fontSize: 12, color: colors.text2 }}>Новое: ложный PIN для защиты от давления</Txt>
          <Txt style={{ color: colors.muted }}>›</Txt>
        </Pressable>

        <View style={{ marginTop: 20 }}>
          <TextTabs<Tab> value={tab} onChange={setTab} size={14}
            options={[{ value: 'hot', label: 'Популярные' }, { value: 'gainers', label: 'Рост' }, { value: 'losers', label: 'Падение' }]} />
        </View>
        <MarketHeader />
        {!markets ? <Notice text="Загружаем цены…" /> : null}
        {rows.map((m) => <MarketRow key={m.coin.cgId} m={m} onPress={() => router.push({ pathname: '/coin', params: { symbol: m.coin.symbol } })} />)}
      </ScrollView>
    </SafeAreaView>
  );
}
