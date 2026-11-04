import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { CHAINS, type LimitOrderInfo } from '@kript/wallet-core';
import { Button, Mono, Notice, TextTabs, Txt } from '../../components/ui';
import { colors } from '../../theme';
import { formatAmount } from '../../format';
import { useWallet } from '../../wallet/WalletProvider';
import { cowOrders, tokenMeta } from '../../wallet/limit';
import type { Hex } from 'viem';

const STATUS_RU: Record<LimitOrderInfo['status'], { label: string; color: string }> = {
  open: { label: 'Открыт', color: colors.brand },
  filled: { label: 'Исполнен', color: colors.up },
  cancelled: { label: 'Отменён', color: colors.muted },
  expired: { label: 'Истёк', color: colors.muted },
  pending: { label: 'Ожидает', color: colors.warn },
};

export default function Orders() {
  const { accounts, withPrivateKey } = useWallet();
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const [orders, setOrders] = useState<LimitOrderInfo[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accounts) return;
    const cow = cowOrders();
    const chains = (['ethereum', 'bsc', 'polygon'] as const).filter((c) => cow.supports(c));
    const res = await Promise.allSettled(chains.map((c) => cow.list(c, accounts.evm.address)));
    const all: LimitOrderInfo[] = [];
    const errs: string[] = [];
    res.forEach((r, i) => (r.status === 'fulfilled' ? all.push(...r.value) : errs.push(CHAINS[chains[i]!].name)));
    all.sort((a, b) => b.created.localeCompare(a.created));
    setOrders(all);
    setErrors(errs);
  }, [accounts]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const cancel = (o: LimitOrderInfo) =>
    Alert.alert('Отменить ордер?', 'Отмена бесплатная. Деньги и так остаются в вашем кошельке.', [
      { text: 'Нет', style: 'cancel' },
      {
        text: 'Отменить', style: 'destructive', onPress: async () => {
          setCancelling(o.uid);
          try { await withPrivateKey('evm', (key) => cowOrders().cancel(o.chain, o.uid as Hex, key)); await load(); }
          catch (e) { Alert.alert('Не удалось отменить', e instanceof Error ? e.message : String(e)); }
          finally { setCancelling(null); }
        },
      },
    ]);

  const shown = (orders ?? []).filter((o) => (tab === 'open' ? o.status === 'open' || o.status === 'pending' : o.status !== 'open' && o.status !== 'pending'));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 }}
        refreshControl={<RefreshControl tintColor={colors.brand} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <TextTabs value={tab} onChange={setTab} size={15}
          options={[{ value: 'open', label: `Открытые (${(orders ?? []).filter((o) => o.status === 'open' || o.status === 'pending').length})` }, { value: 'history', label: 'История ордеров' }]} />
        {errors.length ? <Notice tone="warn" text={`Не удалось загрузить: ${errors.join(', ')}`} /> : null}
        {orders && !shown.length ? <Notice text={tab === 'open' ? 'Открытых ордеров нет. Создайте лимитный ордер на экране «Торговля».' : 'История пуста.'} /> : null}
        {shown.map((o) => {
          const sell = tokenMeta(o.chain, o.sellToken);
          const buy = tokenMeta(o.chain, o.buyToken);
          const st = STATUS_RU[o.status];
          const filled = o.status === 'filled';
          return (
            <View key={o.uid} style={{ paddingVertical: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt weight="bold">{sell.symbol} → {buy.symbol}<Txt style={{ color: colors.muted, fontSize: 12 }}>  {CHAINS[o.chain].name}</Txt></Txt>
                <Txt weight="bold" style={{ fontSize: 12, color: st.color }}>{st.label}</Txt>
              </View>
              <Mono style={{ fontSize: 13, color: colors.text2 }}>
                {formatAmount(o.sellAmount, sell.decimals)} {sell.symbol} → мин. {formatAmount(o.buyAmount, buy.decimals, 8)} {buy.symbol}
              </Mono>
              {filled ? <Mono style={{ fontSize: 13, color: colors.up }}>Получено: {formatAmount(o.executedBuy, buy.decimals, 8)} {buy.symbol}</Mono> : null}
              {o.status === 'open' ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Txt style={{ fontSize: 12, color: colors.muted }}>до {new Date(o.validTo * 1000).toLocaleDateString('ru-RU')}</Txt>
                  <Button title="Отменить" kind="ghost" style={{ height: 28, paddingHorizontal: 12 }} loading={cancelling === o.uid} onPress={() => cancel(o)} />
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
