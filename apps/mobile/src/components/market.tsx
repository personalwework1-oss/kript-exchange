import React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { ChangePill, CoinIcon, Mono, Txt } from './ui';
import { colors, fonts } from '../theme';
import { fmtCompactUsd, fmtPrice } from '../format';
import type { Market } from '../market/prices';

export function SearchBar({ value, onChangeText, onPress, placeholder = 'Поиск монет и пар' }: { value?: string; onChangeText?: (t: string) => void; onPress?: () => void; placeholder?: string }) {
  const icon = (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.muted} strokeWidth={2} strokeLinecap="round"><Circle cx={11} cy={11} r={7} /><Path d="m20 20-3.5-3.5" /></Svg>
  );
  const box = { flex: 1, height: 36, borderRadius: 18, backgroundColor: colors.surface, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 12 };
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={box} accessibilityRole="search" accessibilityLabel={placeholder}>
        {icon}<Txt style={{ fontSize: 13, color: colors.muted }}>{placeholder}</Txt>
      </Pressable>
    );
  }
  return (
    <View style={box}>
      {icon}
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} accessibilityLabel={placeholder}
        autoCapitalize="characters" autoCorrect={false} style={{ flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 0 }} />
    </View>
  );
}

export function MarketHeader() {
  return (
    <View style={{ flexDirection: 'row', paddingTop: 8 }}>
      <Txt style={{ flex: 1, fontSize: 11, color: colors.muted }}>Пара / Объём</Txt>
      <Txt style={{ width: 110, marginRight: 12, textAlign: 'right', fontSize: 11, color: colors.muted }}>Цена</Txt>
      <Txt style={{ width: 74, textAlign: 'right', fontSize: 11, color: colors.muted }}>Изм. 24ч</Txt>
    </View>
  );
}

export function MarketRow({ m, onPress, icon = false }: { m: Market; onPress: () => void; icon?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${m.coin.symbol} к USDT`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', height: 58, gap: 10, opacity: pressed ? 0.7 : 1 })}>
      {icon ? <CoinIcon glyph={m.coin.glyph} color={m.coin.color} size={26} /> : null}
      <View style={{ flex: 1 }}>
        <Txt weight="bold" style={{ fontSize: 15 }}>{m.coin.symbol}<Txt weight="semibold" style={{ fontSize: 12, color: colors.muted }}> /USDT</Txt></Txt>
        <Txt style={{ fontSize: 11, color: colors.muted, marginTop: 3 }}>Об. {fmtCompactUsd(m.volume24h)}</Txt>
      </View>
      <View style={{ width: 110, marginRight: 12, alignItems: 'flex-end' }}>
        <Mono style={{ fontSize: 15 }}>{fmtPrice(m.price)}</Mono>
        <Mono style={{ fontSize: 11, color: colors.muted, marginTop: 3, fontFamily: fonts.regular }}>${fmtPrice(m.price)}</Mono>
      </View>
      <ChangePill pct={m.change24h} />
    </Pressable>
  );
}
