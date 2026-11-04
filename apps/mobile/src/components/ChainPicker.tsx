import React from 'react';
import { Pressable, ScrollView } from 'react-native';
import { CHAINS, type ChainId } from '@kript/wallet-core';
import { Txt } from './ui';
import { colors } from '../theme';
import { CHAIN_ORDER } from '../wallet/networks';

export function ChainPicker({ value, onChange, chains = CHAIN_ORDER }: { value: ChainId; onChange: (c: ChainId) => void; chains?: ChainId[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {chains.map((c) => {
        const active = c === value;
        const info = CHAINS[c];
        return (
          <Pressable key={c} onPress={() => onChange(c)} accessibilityRole="button" accessibilityState={{ selected: active }}
            style={{ height: 38, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', borderWidth: 1,
              borderColor: active ? colors.brand : colors.line2, backgroundColor: active ? colors.brandSoft : 'transparent' }}>
            <Txt weight="semibold" style={{ fontSize: 13 }}>{info.name}{info.tokenStandard && c !== 'solana' ? ` · ${info.tokenStandard}` : ''}</Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
