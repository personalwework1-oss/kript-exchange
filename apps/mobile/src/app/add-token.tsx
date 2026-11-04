import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { CHAINS, findToken, isImpostorSymbol, type ChainId, type TokenMeta } from '@kript/wallet-core';
import { Button, Card, Field, Mono, Notice, Screen, Txt } from '../components/ui';
import { ChainPicker } from '../components/ChainPicker';
import { colors } from '../theme';
import { adapter } from '../wallet/networks';
import { loadCustomTokens, saveCustomTokens } from '../wallet/tokens';

const TOKEN_CHAINS: ChainId[] = ['ethereum', 'tron', 'bsc', 'solana', 'polygon'];

export default function AddToken() {
  const [chain, setChain] = useState<ChainId>('ethereum');
  const [address, setAddress] = useState('');
  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [symbol, setSymbol] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const a = adapter(chain);
  const addr = address.trim();
  const known = addr ? findToken(chain, addr) : undefined;

  const lookup = async () => {
    setBusy(true); setErr(null); setMeta(null);
    try {
      const m = await a.tokenMetadata(addr);
      setMeta(m);
      setSymbol((m.symbol ?? '').slice(0, 16));
    } catch {
      setErr('По этому адресу не найден токен в выбранной сети.');
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!meta || !symbol.trim()) return;
    const list = await loadCustomTokens();
    if (!list.some((t) => t.chain === chain && t.address === addr)) {
      list.push({ chain, address: addr, symbol: symbol.trim().slice(0, 16), decimals: meta.decimals, name: meta.name });
      await saveCustomTokens(list);
    }
    router.back();
  };

  const impostor = meta && symbol ? isImpostorSymbol(chain, symbol, addr) : false;

  return (
    <Screen>
      <View style={{ gap: 16 }}>
        <Txt weight="heavy" style={{ fontSize: 24 }}>Добавить токен</Txt>
        <Notice tone="warn" text="Добавляйте только токены, адрес которых вы взяли с официального сайта проекта. Любой может выпустить токен с названием «USDT» или «USDC»." />
        <ChainPicker value={chain} onChange={(c) => { setChain(c); setMeta(null); setErr(null); }} chains={TOKEN_CHAINS} />
        <Field label={`Адрес контракта в сети ${CHAINS[chain].name}`} value={address} onChangeText={(t) => { setAddress(t); setMeta(null); }} autoCapitalize="none" autoCorrect={false} />
        {known ? <Notice text={`${known.symbol} уже есть в списке проверенных токенов — добавлять не нужно.`} /> : null}
        {!meta && !known ? <Button title="Найти токен" disabled={!addr} loading={busy} onPress={lookup} /> : null}
        {err ? <Notice tone="error" text={err} /> : null}
        {meta ? (
          <Card style={{ gap: 10 }}>
            <Txt style={{ color: colors.muted, fontSize: 13 }}>Найдено в блокчейне</Txt>
            {meta.name ? <Txt weight="semibold">{meta.name}</Txt> : null}
            <Mono style={{ fontSize: 13 }}>Знаков после запятой: {meta.decimals}</Mono>
            <Field label="Символ" value={symbol} onChangeText={setSymbol} autoCapitalize="characters" maxLength={16} />
          </Card>
        ) : null}
        {impostor ? <Notice tone="error" text={`Символ «${symbol}» уже занят проверенным токеном с другим адресом. Почти наверняка это подделка.`} /> : null}
        {meta ? <Button title={impostor ? 'Всё равно добавить' : 'Добавить'} kind={impostor ? 'down' : 'primary'} disabled={!symbol.trim()} onPress={save} /> : null}
        <Button title="Отмена" kind="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
