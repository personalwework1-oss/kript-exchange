import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Screen, Txt } from '../../components/ui';
import { colors } from '../../theme';
import { NETWORK } from '../../config';

const POINTS = [
  'Деньги хранятся в вашем кошельке, а не у нас',
  'Никто не может заморозить ваши средства',
  'Bitcoin, Ethereum, Tron, BSC, Polygon, Solana и USDT',
];

export default function Welcome() {
  return (
    <Screen scroll={false} style={{ justifyContent: 'space-between' }}>
      <View style={{ gap: 18, paddingTop: 48 }}>
        <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
          <Txt weight="heavy" style={{ color: colors.bg, fontSize: 28 }}>K</Txt>
        </View>
        <Txt weight="heavy" style={{ fontSize: 32, lineHeight: 37 }}>Ваша крипта.{'\n'}Ваши ключи.</Txt>
        <Txt style={{ color: colors.text2, lineHeight: 22 }}>Торгуйте как на бирже, но деньги всегда остаются в вашем кошельке.</Txt>
        <View style={{ gap: 10, marginTop: 8 }}>
          {POINTS.map((p) => (
            <View key={p} style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surface }}>
              <Txt weight="heavy" style={{ color: colors.up }}>✓</Txt>
              <Txt style={{ flex: 1, fontSize: 14 }}>{p}</Txt>
            </View>
          ))}
        </View>
        {NETWORK === 'testnet' ? <Txt style={{ color: colors.warn, fontSize: 13 }}>Тестовый режим: используются тестовые сети</Txt> : null}
      </View>
      <View style={{ gap: 10, paddingBottom: 12 }}>
        <Button title="Создать кошелёк" onPress={() => router.push('/onboarding/create')} />
        <Button title="У меня уже есть сид-фраза" kind="ghost" onPress={() => router.push('/onboarding/import')} />
      </View>
    </Screen>
  );
}
