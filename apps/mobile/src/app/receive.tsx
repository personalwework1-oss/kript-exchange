import React, { useState } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { CHAINS, type ChainId } from '@kript/wallet-core';
import { Button, Mono, Notice, Screen, Txt } from '../components/ui';
import { ChainPicker } from '../components/ChainPicker';
import { colors } from '../theme';
import { useWallet } from '../wallet/WalletProvider';
import { addressOf, networkLabel, usdtSupported } from '../wallet/networks';

export default function Receive() {
  const { accounts } = useWallet();
  const [chain, setChain] = useState<ChainId>('tron');
  const [copied, setCopied] = useState(false);
  if (!accounts) return null;
  const address = addressOf(accounts, chain);
  const assets = chain === 'bitcoin' ? 'BTC' : `${CHAINS[chain].nativeSymbol}${usdtSupported(chain) ? ', USDT' : ''} и токены ${CHAINS[chain].tokenStandard ?? ''}`.trim();

  const copy = async () => {
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Screen>
      <View style={{ gap: 18 }}>
        <Txt weight="heavy" style={{ fontSize: 24 }}>Получить</Txt>
        <ChainPicker value={chain} onChange={setChain} />
        <View style={{ alignSelf: 'center', padding: 16, borderRadius: 20, backgroundColor: '#fff' }}>
          <QRCode value={address} size={200} />
        </View>
        <Mono style={{ textAlign: 'center', fontSize: 14, lineHeight: 21 }} selectable>{address}</Mono>
        <Button title={copied ? 'Скопировано' : 'Скопировать адрес'} onPress={copy} />
        <Notice tone="warn" text={`Отправляйте на этот адрес только ${assets} в сети ${networkLabel(chain)}. Монеты из другой сети могут быть потеряны.`} />
        {chain === 'ethereum' || chain === 'bsc' || chain === 'polygon' ? (
          <Txt style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>Этот же адрес используется в Ethereum, BSC и Polygon</Txt>
        ) : null}
        <Button title="Готово" kind="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
