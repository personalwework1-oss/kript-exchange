/**
 * Limit order form (CoW Protocol). Funds stay in the wallet until the order fills.
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { LimitOrderError, type PreparedLimitOrder } from '@kript/wallet-core';
import { Button, Card, Field, Mono, Notice, Segmented, Txt } from './ui';
import { colors } from '../theme';
import { formatAmount, fmtPrice, parseAmount } from '../format';
import { useWallet } from '../wallet/WalletProvider';
import { addressOf } from '../wallet/networks';
import { cowOrders, LIMIT_PAIRS, limitUsdt } from '../wallet/limit';

const EXPIRY = [{ value: '1', label: '1 день' }, { value: '7', label: '7 дней' }, { value: '30', label: '30 дней' }] as const;
const ERR_RU: Record<LimitOrderError['code'], string> = {
  invalid: 'Проверьте цену и сумму',
  insufficient_funds: 'Недостаточно средств',
  api: 'Сервис ордеров не принял заявку. Попробуйте ещё раз.',
  unsupported: 'Лимитные ордера для этой монеты пока недоступны',
  mismatch: 'Проверка безопасности не прошла. Ордер не отправлен.',
};
const errText = (e: unknown) => (e instanceof LimitOrderError ? ERR_RU[e.code] : e instanceof Error ? e.message : String(e));

export function LimitPanel({ symbol, side, marketPrice }: { symbol: string; side: 'buy' | 'sell'; marketPrice?: number }) {
  const { accounts, withPrivateKey } = useWallet();
  const pair = LIMIT_PAIRS[symbol];
  const usdt = pair ? limitUsdt(pair.chain) : null;
  const [priceText, setPriceText] = useState(marketPrice ? String(Number(marketPrice.toPrecision(6))) : '');
  const [amountText, setAmountText] = useState('');
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const [prepared, setPrepared] = useState<PreparedLimitOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const calc = useMemo(() => {
    if (!pair || !usdt) return null;
    const price = parseAmount(priceText, usdt.decimals); // USDT per 1 coin
    const coinUnit = 10n ** BigInt(pair.token.decimals);
    if (!price || price <= 0n) return null;
    if (side === 'buy') {
      const spend = parseAmount(amountText, usdt.decimals);
      if (!spend || spend <= 0n) return null;
      return { sell: usdt, buy: pair.token, sellAmount: spend, buyAmount: (spend * coinUnit) / price, price };
    }
    const qty = parseAmount(amountText, pair.token.decimals);
    if (!qty || qty <= 0n) return null;
    return { sell: pair.token, buy: usdt, sellAmount: qty, buyAmount: (qty * price) / coinUnit, price };
  }, [pair, usdt, priceText, amountText, side]);

  if (!pair) return <Notice text={`Лимитные ордера доступны для ETH, LINK, BNB и POL. Для ${symbol} — скоро.`} />;
  if (!usdt) return <Notice text="В тестовом режиме лимитные ордера работают только в Sepolia, и нужен тестовый USDT (EXPO_PUBLIC_SEPOLIA_USDT)." />;

  const priceNum = Number(priceText.replace(',', '.'));
  const diff = marketPrice && priceNum > 0 ? ((priceNum - marketPrice) / marketPrice) * 100 : null;

  const review = async () => {
    if (!calc || !accounts) return;
    setBusy(true); setErr(null);
    try {
      setPrepared(await cowOrders().prepare({
        chain: pair.chain, owner: addressOf(accounts, pair.chain), sell: calc.sell, buy: calc.buy,
        sellAmount: calc.sellAmount, buyAmount: calc.buyAmount, validForSec: Number(days) * 86400,
      }));
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const place = async () => {
    if (!prepared) return;
    setBusy(true); setErr(null);
    try {
      const r = await withPrivateKey('evm', (key) => cowOrders().place(prepared, key));
      setDone(r.uid); setPrepared(null); setAmountText('');
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Card style={{ gap: 12, alignItems: 'center' }}>
        <Txt weight="heavy" style={{ fontSize: 20 }}>Ордер размещён</Txt>
        <Txt style={{ color: colors.text2, textAlign: 'center' }}>Он исполнится автоматически, когда цена дойдёт до вашей. Деньги до этого остаются в кошельке.</Txt>
        <Button title="Мои ордера" style={{ alignSelf: 'stretch' }} onPress={() => router.push('/orders')} />
        <Button title="Новый ордер" kind="ghost" style={{ alignSelf: 'stretch' }} onPress={() => setDone(null)} />
      </Card>
    );
  }

  if (prepared && calc) {
    const r = prepared.request;
    return (
      <View style={{ gap: 12 }}>
        <Card style={{ gap: 10 }}>
          <Txt weight="bold">{side === 'buy' ? `Купить ${symbol}` : `Продать ${symbol}`} по {fmtPrice(priceNum)} USDT</Txt>
          <Row k="Отдаёте" v={`${formatAmount(r.sellAmount, r.sell.decimals)} ${r.sell.symbol}`} />
          <Row k="Получите минимум" v={`${formatAmount(r.buyAmount, r.buy.decimals, 8)} ${r.buy.symbol}`} />
          <Row k="Действует" v={`${days} дн.`} />
        </Card>
        {prepared.wrapAmount > 0n ? <Notice text={`Сначала ${formatAmount(prepared.wrapAmount, 18)} ${symbol} будут обёрнуты в W${symbol} — так требует протокол. Это отдельная транзакция.`} /> : null}
        {prepared.approveTo !== null ? <Notice text="Кошелёк выдаст протоколу разрешение на списание только этой суммы (плюс уже разрешённое для других ордеров). Это отдельная транзакция с комиссией сети." /> : null}
        <Notice tone="warn" text="Размещение ордера бесплатное: это подпись, а не транзакция. Отменить можно в любой момент во вкладке «Ордера»." />
        {err ? <Notice tone="error" text={err} /> : null}
        <Button title="Разместить ордер" kind={side === 'buy' ? 'up' : 'down'} loading={busy} onPress={place} />
        <Button title="Изменить" kind="ghost" disabled={busy} onPress={() => setPrepared(null)} />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Field label={`Цена, USDT за 1 ${symbol}`} value={priceText} onChangeText={setPriceText} keyboardType="decimal-pad" placeholder={marketPrice ? fmtPrice(marketPrice) : '0'} />
      {diff !== null && Number.isFinite(diff) ? (
        <Txt style={{ fontSize: 13, color: colors.muted }}>
          {diff >= 0 ? 'Выше' : 'Ниже'} рынка на <Mono style={{ fontSize: 13, color: diff >= 0 ? colors.up : colors.down }}>{Math.abs(diff).toFixed(2).replace('.', ',')}%</Mono>
        </Txt>
      ) : null}
      <Field label={side === 'buy' ? 'Потратить, USDT' : `Продать, ${symbol}`} value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" placeholder="0" />
      {calc ? (
        <Txt style={{ color: colors.text2 }}>
          Получите минимум <Mono bold>{formatAmount(calc.buyAmount, calc.buy.decimals, 8)} {calc.buy.symbol}</Mono>
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Txt style={{ color: colors.muted, fontSize: 13 }}>Срок</Txt>
        <View style={{ flex: 1 }}><Segmented value={days} onChange={setDays} options={EXPIRY.map((e) => ({ ...e }))} /></View>
      </View>
      {err ? <Notice tone="error" text={err} /> : null}
      <Button title={side === 'buy' ? `Купить ${symbol} по лимиту` : `Продать ${symbol} по лимиту`} kind={side === 'buy' ? 'up' : 'down'} disabled={!calc} loading={busy} onPress={review} />
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Txt style={{ color: colors.muted, fontSize: 14 }}>{k}</Txt>
      <Mono bold style={{ fontSize: 14, flexShrink: 1, textAlign: 'right' }}>{v}</Mono>
    </View>
  );
}
