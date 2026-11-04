/**
 * Market buy/sell against USDT on the coin's own chain, via 0x (EVM) or Jupiter (Solana).
 * Flow: type amount -> indicative price -> firm quote (validated) -> confirm -> sign -> done.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { CHAINS, SwapError, type ChainId, type SwapQuote, type SwapRequest } from '@kript/wallet-core';
import { Button, Card, Field, Mono, Notice, Segmented, SideSwitch, Txt } from './ui';
import { colors } from '../theme';
import { formatAmount, parseAmount } from '../format';
import { useWallet } from '../wallet/WalletProvider';
import { addressOf, adapter, familyOf } from '../wallet/networks';
import { swapPairsFor, SWAPS_ENABLED, swapProvider, usdtToken } from '../wallet/swap';
import { ChainPicker } from './ChainPicker';
import { useBalances } from '../wallet/useBalances';
import { LimitPanel } from './LimitPanel';

const ERR_RU: Record<SwapError['code'], string> = {
  no_liquidity: 'Сейчас нет ликвидности для этой пары. Попробуйте другую сумму.',
  insufficient_funds: 'Недостаточно средств',
  insufficient_fee: 'Не хватает монет сети на комиссию',
  expired: 'Котировка устарела. Обновите её.',
  unsafe_quote: 'Котировка не прошла проверку безопасности. Сделка остановлена.',
  api: 'Сервис обмена не ответил. Попробуйте ещё раз.',
  unsupported: 'Обмен для этой монеты пока недоступен',
};
const errText = (e: unknown) => (e instanceof SwapError ? ERR_RU[e.code] : e instanceof Error ? e.message : String(e));

type Phase = 'form' | 'quoting' | 'review' | 'executing' | 'done';
const SLIPPAGES = [{ value: '30', label: '0,3%' }, { value: '50', label: '0,5%' }, { value: '100', label: '1%' }] as const;

export function SwapPanel({ symbol, marketPrice, type: typeProp, initialSide = 'buy' }: { symbol: string; marketPrice?: number; type?: 'market' | 'limit'; initialSide?: 'buy' | 'sell' }) {
  const { accounts, withPrivateKey } = useWallet();
  const { rows, holdings, reload } = useBalances(accounts);
  const pairs = useMemo(() => swapPairsFor(symbol), [symbol]);
  const [pairChain, setPairChain] = useState<ChainId | undefined>(pairs[0]?.chain);
  const pair = pairs.find((p) => p.chain === pairChain) ?? pairs[0];
  const [side, setSide] = useState<'buy' | 'sell'>(initialSide);
  const [typeState, setType] = useState<'market' | 'limit'>('market');
  const type = typeProp ?? typeState;
  const [slip, setSlip] = useState<'30' | '50' | '100'>('50');
  const [amountText, setAmountText] = useState('');
  const [estimate, setEstimate] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [result, setResult] = useState<{ txid: string; approvalTxid?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const chain = pair?.chain;
  const provider = chain ? swapProvider(chain) : null;
  const usdt = chain && chain !== 'bitcoin' ? usdtToken(chain as Exclude<ChainId, 'bitcoin'>) : null;
  const sellTok = side === 'buy' ? usdt : pair?.token;
  const buyTok = side === 'buy' ? pair?.token : usdt;
  const amount = sellTok ? parseAmount(amountText, sellTok.decimals) : null;

  const bal = rows.find((r) => r.chain === chain)?.balances;
  const available = !sellTok || !bal ? undefined
    : sellTok.symbol === 'USDT' ? bal.usdt
    : sellTok.symbol === CHAINS[chain!].nativeSymbol ? bal.native
    : (holdings.find((h) => h.chain === chain && h.token?.address === sellTok.address)?.amount ?? 0n);

  const req: SwapRequest | null = useMemo(() => {
    if (!accounts || !chain || !sellTok || !buyTok || !amount || amount <= 0n) return null;
    return { chain, sell: sellTok, buy: buyTok, sellAmount: amount, taker: addressOf(accounts, chain), slippageBps: Number(slip) };
  }, [accounts, chain, sellTok, buyTok, amount, slip]);

  // Debounced indicative price
  useEffect(() => {
    setEstimate(null);
    if (!req || !provider || phase !== 'form') return;
    const t = setTimeout(() => {
      provider.price(req).then((p) => setEstimate(p.buyAmount)).catch(() => setEstimate(null));
    }, 600);
    return () => clearTimeout(t);
  }, [req, provider, phase]);

  const marketUnavailable = !SWAPS_ENABLED
    ? 'Рыночные обмены работают только в основных сетях. Сейчас приложение в тестовом режиме.'
    : !pair ? `${symbol}: рыночный обмен пока недоступен (только отслеживание цены).`
    : !provider ? 'Не настроен ключ агрегатора (EXPO_PUBLIC_0X_API_KEY).' : null;

  const getQuote = async () => {
    if (!req || !provider) return;
    setPhase('quoting'); setErr(null);
    try { setQuote(await provider.quote(req)); setPhase('review'); }
    catch (e) { setErr(errText(e)); setPhase('form'); }
  };

  const execute = async () => {
    if (!quote) return;
    setPhase('executing'); setErr(null);
    try {
      const r = await withPrivateKey(familyOf(quote.request.chain), (key) => provider!.execute(quote, key));
      setResult(r); setPhase('done'); reload();
    } catch (e) { setErr(errText(e)); setPhase('review'); }
  };

  const reset = () => { setPhase('form'); setQuote(null); setResult(null); setAmountText(''); setErr(null); };

  if (phase === 'done' && result) {
    return (
      <Card style={{ gap: 12, alignItems: 'center' }}>
        <Txt weight="heavy" style={{ fontSize: 20 }}>Сделка отправлена</Txt>
        <Txt style={{ color: colors.text2, textAlign: 'center' }}>
          {formatAmount(quote!.request.sellAmount, quote!.request.sell.decimals)} {quote!.request.sell.symbol} → ≈ {formatAmount(quote!.buyAmount, quote!.request.buy.decimals)} {quote!.request.buy.symbol}
        </Txt>
        <Button title="Открыть в обозревателе" kind="ghost" style={{ alignSelf: 'stretch' }} onPress={() => Linking.openURL(adapter(quote!.request.chain).explorerTxUrl(result.txid))} />
        <Button title="Новая сделка" style={{ alignSelf: 'stretch' }} onPress={reset} />
      </Card>
    );
  }

  if ((phase === 'review' || phase === 'executing') && quote) {
    const r = quote.request;
    const native = CHAINS[r.chain];
    // Compare the quoted price with the market: warn if the deal is noticeably worse.
    const toNum = (v: bigint, d: number) => Number(v) / 10 ** d;
    const coinQty = side === 'buy' ? toNum(quote.buyAmount, r.buy.decimals) : toNum(r.sellAmount, r.sell.decimals);
    const usdtQty = side === 'buy' ? toNum(r.sellAmount, r.sell.decimals) : toNum(quote.buyAmount, r.buy.decimals);
    const dealPrice = coinQty > 0 ? usdtQty / coinQty : 0;
    const worsePct = marketPrice && dealPrice ? (side === 'buy' ? dealPrice / marketPrice - 1 : 1 - dealPrice / marketPrice) * 100 : 0;
    return (
      <View style={{ gap: 12 }}>
        <Card style={{ gap: 10 }}>
          <Row k="Отдаёте" v={`${formatAmount(r.sellAmount, r.sell.decimals)} ${r.sell.symbol}`} />
          <Row k="Получите ≈" v={`${formatAmount(quote.buyAmount, r.buy.decimals)} ${r.buy.symbol}`} accent />
          <Row k="Гарантированный минимум" v={`${formatAmount(quote.minBuyAmount, r.buy.decimals)} ${r.buy.symbol}`} />
          {quote.networkFee !== undefined ? (
            <Row k="Комиссия сети" v={quote.networkFee === 0n ? 'оплачивает агрегатор' : `≈ ${formatAmount(quote.networkFee, native.nativeDecimals, 6)} ${native.nativeSymbol}`} />
          ) : null}
          <Row k="Маршрут" v={quote.route} />
          <Row k="Сеть" v={native.name} />
        </Card>
        {worsePct > 3 ? (
          <Notice tone="error" text={`Цена сделки хуже рыночной на ${worsePct.toFixed(1).replace('.', ',')}%. Возможно, мало ликвидности для такой суммы — попробуйте меньшую сумму.`} />
        ) : null}
        {quote.needsApproval ? (
          <Notice text={`Сначала кошелёк разрешит списать ровно ${formatAmount(r.sellAmount, r.sell.decimals)} ${r.sell.symbol} — не больше. Это отдельная транзакция с небольшой комиссией.`} />
        ) : null}
        <Notice tone="warn" text="Монеты остаются в вашем кошельке до момента обмена. Если цена уйдёт ниже минимума, сделка отменится автоматически." />
        {err ? <Notice tone="error" text={err} /> : null}
        <Button title="Подтвердить сделку" kind={side === 'buy' ? 'up' : 'down'} loading={phase === 'executing'} onPress={execute} />
        <Button title="Изменить" kind="ghost" disabled={phase === 'executing'} onPress={() => setPhase('form')} />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <SideSwitch value={side} onChange={(s) => { setSide(s); setAmountText(''); }} />
      {typeProp ? null : <Segmented value={type} onChange={setType} options={[{ value: 'market', label: 'Рыночный' }, { value: 'limit', label: 'Лимит' }]} />}
      {type === 'limit' ? (
        <LimitPanel symbol={symbol} side={side} marketPrice={marketPrice} />
      ) : marketUnavailable ? (
        <Notice text={marketUnavailable} />
      ) : pair ? (
        <>
          {pairs.length > 1 ? <ChainPicker value={pair.chain} onChange={(c) => { setPairChain(c); setAmountText(''); }} chains={pairs.map((p) => p.chain)} /> : null}
          <Field label={side === 'buy' ? 'Потратить, USDT' : `Продать, ${symbol}`} value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" placeholder="0" />
          <Txt style={{ color: colors.muted, fontSize: 13 }}>
            Доступно: <Txt style={{ fontSize: 13 }}>{available !== undefined && sellTok ? `${formatAmount(available, sellTok.decimals)} ${sellTok.symbol}` : '…'}</Txt>
            {`  ·  ${CHAINS[pair.chain].name}`}
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Txt style={{ color: colors.muted, fontSize: 13 }}>Проскальзывание</Txt>
            <View style={{ flex: 1 }}><Segmented value={slip} onChange={setSlip} options={SLIPPAGES.map((s) => ({ ...s }))} /></View>
          </View>
          {estimate !== null && buyTok ? (
            <Txt style={{ color: colors.text2 }}>Получите ≈ <Mono bold>{formatAmount(estimate, buyTok.decimals)} {buyTok.symbol}</Mono></Txt>
          ) : null}
          {err ? <Notice tone="error" text={err} /> : null}
          <Button
            title={side === 'buy' ? `Купить ${symbol}` : `Продать ${symbol}`}
            kind={side === 'buy' ? 'up' : 'down'}
            disabled={!req || (available !== undefined && amount !== null && amount > available)}
            loading={phase === 'quoting'}
            onPress={getQuote}
          />
        </>
      ) : null}
    </View>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Txt style={{ color: colors.muted, fontSize: 14 }}>{k}</Txt>
      <Mono bold style={{ fontSize: 14, color: accent ? colors.up : colors.text, flexShrink: 1, textAlign: 'right' }}>{v}</Mono>
    </View>
  );
}
