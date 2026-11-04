import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ChainId } from '@kript/wallet-core';
import { Chips, Notice, TextTabs } from '../../components/ui';
import { MarketHeader, MarketRow, SearchBar } from '../../components/market';
import { chainsOf, useMarkets } from '../../market/prices';
import { colors } from '../../theme';

type Tab = 'all' | 'gainers' | 'losers';
type Net = 'any' | ChainId;
const NETS: { value: Net; label: string }[] = [
  { value: 'any', label: 'Все' }, { value: 'ethereum', label: 'Ethereum' }, { value: 'bsc', label: 'BNB Chain' },
  { value: 'solana', label: 'Solana' }, { value: 'tron', label: 'Tron' }, { value: 'polygon', label: 'Polygon' }, { value: 'bitcoin', label: 'Bitcoin' },
];

export default function Markets() {
  const { data, error, reload } = useMarkets();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [net, setNet] = useState<Net>('any');
  const [refreshing, setRefreshing] = useState(false);

  const rows = useMemo(() => {
    let r = (data ?? []).filter((m) => m.coin.symbol !== 'USDT');
    if (q) r = r.filter((m) => (m.coin.symbol + m.coin.name).toLowerCase().includes(q.toLowerCase()));
    if (net !== 'any') r = r.filter((m) => chainsOf(m.coin).includes(net));
    if (tab === 'gainers') return [...r].sort((a, b) => b.change24h - a.change24h);
    if (tab === 'losers') return [...r].sort((a, b) => a.change24h - b.change24h);
    return [...r].sort((a, b) => b.volume24h - a.volume24h);
  }, [data, q, tab, net]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl tintColor={colors.brand} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}>
        <View style={{ flexDirection: 'row', paddingTop: 4 }}><SearchBar value={q} onChangeText={setQ} /></View>
        <View style={{ marginTop: 16 }}>
          <TextTabs<Tab> value={tab} onChange={setTab} size={17}
            options={[{ value: 'all', label: 'Рынок' }, { value: 'gainers', label: 'Рост' }, { value: 'losers', label: 'Падение' }]} />
        </View>
        <View style={{ marginTop: 10 }}><Chips<Net> value={net} onChange={setNet} options={NETS} /></View>
        {error && !data ? <View style={{ marginTop: 12 }}><Notice tone="error" text={`Не удалось загрузить цены: ${error}`} /></View> : null}
        <MarketHeader />
        {rows.map((m) => <MarketRow key={m.coin.cgId} m={m} icon onPress={() => router.push({ pathname: '/coin', params: { symbol: m.coin.symbol } })} />)}
        {data && !rows.length ? <Notice text="Ничего не найдено" /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
