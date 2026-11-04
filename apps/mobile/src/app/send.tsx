import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CHAINS, TransferError, USDT, type ChainId, type PreparedTransfer, type TokenRef, type TransferRequest } from '@kript/wallet-core';
import { Button, Card, Field, Mono, Notice, Screen, Txt } from '../components/ui';
import { registryTokens, TRUST_LABEL, type TrustLevel } from '../wallet/tokens';
import { ChainPicker } from '../components/ChainPicker';
import { colors } from '../theme';
import { formatAmount, parseAmount, shortAddr } from '../format';
import { useWallet } from '../wallet/WalletProvider';
import { adapter, addressOf, familyOf, networkLabel, usdtSupported } from '../wallet/networks';
import { useBalances } from '../wallet/useBalances';

const ERR_RU: Record<TransferError['code'], string> = {
  invalid_address: 'Неверный адрес получателя для этой сети',
  invalid_amount: 'Неверная сумма',
  insufficient_funds: 'Недостаточно средств',
  insufficient_fee: 'Не хватает монет сети на комиссию',
  self_transfer: 'Это ваш собственный адрес',
  unsupported: 'Эта операция не поддерживается в выбранной сети',
  verification_failed: 'Проверка транзакции не прошла. Операция остановлена ради безопасности.',
};

function errText(e: unknown) {
  if (e instanceof TransferError) return ERR_RU[e.code];
  return e instanceof Error ? e.message : String(e);
}

type Phase = 'form' | 'review' | 'sending' | 'done';

export default function Send() {
  const { accounts, withPrivateKey } = useWallet();
  const params = useLocalSearchParams<{ chain?: string; token?: string }>();
  const { rows, holdings } = useBalances(accounts);
  const [chain, setChain] = useState<ChainId>((params.chain as ChainId) ?? 'tron');
  const [assetId, setAssetId] = useState<string>(params.token ?? (usdtSupported((params.chain as ChainId) ?? 'tron') ? 'usdt' : 'native'));
  const [to, setTo] = useState('');
  const [amountText, setAmountText] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Assets on this chain: native, USDT, registry tokens, and any token the wallet holds.
  const bal = rows.find((r) => r.chain === chain)?.balances;
  type Opt = { id: string; symbol: string; decimals: number; token?: TokenRef; trust: TrustLevel; available?: bigint };
  const options: Opt[] = useMemo(() => {
    const c = CHAINS[chain];
    const list: Opt[] = [{ id: 'native', symbol: c.nativeSymbol, decimals: c.nativeDecimals, trust: 'verified', available: bal?.native }];
    if (chain !== 'bitcoin' && usdtSupported(chain)) {
      list.push({ id: 'usdt', symbol: 'USDT', decimals: USDT[chain].decimals, trust: 'verified', available: bal?.usdt });
    }
    const usdtAddr = chain !== 'bitcoin' ? USDT[chain].address : '';
    for (const h of holdings.filter((x) => x.chain === chain && x.token && x.token.address !== usdtAddr)) {
      list.push({ id: h.token!.address, symbol: h.symbol, decimals: h.decimals, token: h.token, trust: h.trust, available: h.amount });
    }
    for (const t of registryTokens(chain)) {
      if (t.address === usdtAddr || list.some((o) => o.id === t.address)) continue;
      list.push({ id: t.address, symbol: t.symbol, decimals: t.decimals, token: { address: t.address, decimals: t.decimals, symbol: t.symbol }, trust: 'verified', available: 0n });
    }
    return list;
  }, [chain, bal, holdings]);
  const opt = options.find((o) => o.id === assetId) ?? options[0]!;
  const symbol = opt.symbol;
  const decimals = opt.decimals;
  const available = opt.available;
  const a = adapter(chain);

  const amount = useMemo(() => parseAmount(amountText, decimals), [amountText, decimals]);
  const toErr = to && !a.validateAddress(to.trim()) ? 'Адрес не подходит для этой сети' : null;
  const amtErr = amountText && (amount === null || amount <= 0n) ? 'Неверная сумма' : amount && available !== undefined && amount > available ? 'Больше, чем на балансе' : null;
  const formOk = !!to && !toErr && !!amount && amount > 0n && !amtErr;

  if (!accounts) return null;
  const from = addressOf(accounts, chain);

  const review = async () => {
    setBusy(true); setErr(null);
    try {
      const req: TransferRequest = opt.id === 'native' ? { chain, asset: 'native', from, to: to.trim(), amount: amount! }
        : opt.id === 'usdt' ? { chain, asset: 'usdt', from, to: to.trim(), amount: amount! }
        : { chain, asset: 'token', token: opt.token, from, to: to.trim(), amount: amount! };
      setPrepared(await a.prepareTransfer(req));
      setPhase('review');
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!prepared) return;
    setPhase('sending'); setErr(null);
    try {
      const signed = await withPrivateKey(familyOf(chain), (key) => a.signTransfer(prepared, key));
      setTxid(await a.broadcast(signed));
      setPhase('done');
    } catch (e) { setErr(errText(e)); setPhase('review'); }
  };

  if (phase === 'done' && txid) {
    return (
      <Screen>
        <View style={{ gap: 16, paddingTop: 40, alignItems: 'center' }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.up, alignItems: 'center', justifyContent: 'center' }}>
            <Txt weight="heavy" style={{ color: colors.bg, fontSize: 34 }}>✓</Txt>
          </View>
          <Txt weight="heavy" style={{ fontSize: 24 }}>Отправлено</Txt>
          <Txt style={{ color: colors.text2, textAlign: 'center' }}>
            {formatAmount(prepared!.request.amount, decimals)} {symbol} → {shortAddr(prepared!.request.to)}
          </Txt>
          <Button title="Открыть в обозревателе" kind="ghost" style={{ alignSelf: 'stretch' }} onPress={() => Linking.openURL(a.explorerTxUrl(txid))} />
          <Button title="Готово" style={{ alignSelf: 'stretch' }} onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if ((phase === 'review' || phase === 'sending') && prepared) {
    const feeSym = prepared.fee.symbol;
    const feeDec = CHAINS[chain].nativeDecimals;
    return (
      <Screen>
        <View style={{ gap: 16 }}>
          <Txt weight="heavy" style={{ fontSize: 24 }}>Проверьте перевод</Txt>
          <Card style={{ gap: 6 }}>
            <Txt style={{ color: colors.muted, fontSize: 13 }}>Вы отправляете</Txt>
            <Mono bold style={{ fontSize: 28 }}>{formatAmount(prepared.request.amount, decimals)} {symbol}</Mono>
            <Txt style={{ color: colors.muted, fontSize: 13 }}>{networkLabel(chain)}</Txt>
          </Card>
          <Card style={{ gap: 12 }}>
            <View style={{ gap: 4 }}>
              <Txt style={{ color: colors.muted, fontSize: 13 }}>Получатель</Txt>
              <Mono style={{ fontSize: 13, lineHeight: 19 }} selectable>{prepared.request.to}</Mono>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Txt style={{ color: colors.muted, fontSize: 14 }}>Комиссия сети</Txt>
              <Mono bold style={{ fontSize: 14 }}>≈ {formatAmount(prepared.fee.amount, feeDec, 8)} {feeSym}</Mono>
            </View>
            {prepared.fee.note ? <Txt style={{ color: colors.muted, fontSize: 12 }}>{prepared.fee.note}</Txt> : null}
          </Card>
          <Notice tone="warn" text="Переводы в блокчейне необратимы. Проверьте первые и последние символы адреса." />
          {err ? <Notice tone="error" text={err} /> : null}
          <Button title="Подтвердить и отправить" loading={phase === 'sending'} onPress={confirm} />
          <Button title="Изменить" kind="ghost" disabled={phase === 'sending'} onPress={() => setPhase('form')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: 16 }}>
        <Txt weight="heavy" style={{ fontSize: 24 }}>Отправить</Txt>
        <ChainPicker value={chain} onChange={(c) => { setChain(c); setTo(''); setAssetId(usdtSupported(c) ? 'usdt' : 'native'); }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {options.map((o) => {
            const active = o.id === opt.id;
            return (
              <Pressable key={o.id} onPress={() => { setAssetId(o.id); setAmountText(''); }} accessibilityRole="button" accessibilityState={{ selected: active }}
                style={{ height: 36, paddingHorizontal: 12, borderRadius: 10, justifyContent: 'center', borderWidth: 1,
                  borderColor: active ? colors.brand : o.trust === 'suspicious' ? colors.down : colors.line2, backgroundColor: active ? colors.brandSoft : 'transparent' }}>
                <Txt weight="semibold" style={{ fontSize: 13 }}>{o.symbol}</Txt>
              </Pressable>
            );
          })}
        </ScrollView>
        {opt.trust !== 'verified' ? (
          <Notice tone={opt.trust === 'suspicious' ? 'error' : 'warn'} text={`${TRUST_LABEL[opt.trust]}: ${opt.symbol} нет в нашем списке проверенных токенов.${opt.trust === 'suspicious' ? ' Его название совпадает с известным токеном, но адрес другой — скорее всего это подделка.' : ''}`} />
        ) : null}
        <Field label="Адрес получателя" value={to} onChangeText={setTo} autoCapitalize="none" autoCorrect={false} error={toErr} placeholder={`Адрес в сети ${CHAINS[chain].name}`} />
        <Field label={`Сумма, ${symbol}`} value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" placeholder="0" error={amtErr} />
        <Pressable disabled={available === undefined} onPress={() => available !== undefined && setAmountText(formatAmount(available, decimals, decimals).replace(/ /g, ''))}>
          <Txt style={{ color: colors.muted, fontSize: 13 }}>
            Доступно: <Txt style={{ color: colors.text, fontSize: 13 }}>{available !== undefined ? `${formatAmount(available, decimals)} ${symbol}` : '…'}</Txt>
            {available !== undefined && opt.id !== 'native' ? <Txt style={{ color: colors.brand, fontSize: 13 }}>  Всё</Txt> : null}
          </Txt>
        </Pressable>
        {err ? <Notice tone="error" text={err} /> : null}
        <Button title="Далее" disabled={!formOk} loading={busy} onPress={review} />
      </View>
    </Screen>
  );
}
