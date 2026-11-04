import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius } from '../theme';

export function Txt({ style, weight = 'regular', ...p }: TextProps & { weight?: keyof typeof fonts }) {
  return <Text {...p} style={[{ color: colors.text, fontFamily: fonts[weight], fontSize: 15 }, style]} />;
}

export function Mono({ style, bold, ...p }: TextProps & { bold?: boolean }) {
  return <Text {...p} style={[{ color: colors.text, fontFamily: bold ? fonts.monoBold : fonts.mono, fontSize: 14, fontVariant: ['tabular-nums'], letterSpacing: -0.2 }, style]} />;
}

export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: ViewStyle }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {scroll ? (
        <ScrollView contentContainerStyle={[{ padding: 16, paddingBottom: 40 }, style]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, padding: 16 }, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type BtnKind = 'primary' | 'secondary' | 'up' | 'down' | 'ghost';
export function Button({
  title, onPress, kind = 'primary', disabled, loading, style,
}: { title: string; onPress?: () => void; kind?: BtnKind; disabled?: boolean; loading?: boolean; style?: ViewStyle }) {
  const bg = { primary: colors.brand, secondary: colors.surface2, up: colors.up, down: colors.down, ghost: 'transparent' }[kind];
  const fg = kind === 'secondary' || kind === 'ghost' ? colors.text : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        kind === 'ghost' && { backgroundColor: colors.surface2 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Txt weight="bold" style={{ color: fg, fontSize: 15 }}>{title}</Txt>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Field({ label, error, ...p }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt style={{ color: colors.muted, fontSize: 13 }}>{label}</Txt>
      <TextInput
        placeholderTextColor={colors.muted}
        {...p}
        style={[s.input, error ? { borderColor: colors.down } : null, p.style]}
        accessibilityLabel={label}
      />
      {error ? <Txt style={{ color: colors.down, fontSize: 12 }}>{error}</Txt> : null}
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={s.seg}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.segItem, active && { backgroundColor: colors.surface2 }]} accessibilityRole="button" accessibilityState={{ selected: active }}>
            <Txt weight={active ? 'bold' : 'regular'} style={{ color: active ? colors.text : colors.muted, fontSize: 13 }}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ChangePill({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <View style={[s.pill, { backgroundColor: up ? colors.up : colors.down }]}>
      <Mono bold style={{ color: '#FFFFFF', fontSize: 13 }}>
        {(up ? '+' : '−') + Math.abs(pct).toFixed(2).replace('.', ',') + '%'}
      </Mono>
    </View>
  );
}

export function CoinIcon({ glyph, color, size = 36 }: { glyph: string; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Txt weight="heavy" style={{ color: '#fff', fontSize: size * 0.46 }}>{glyph}</Txt>
    </View>
  );
}

/** Exchange-style text tabs with a short accent underline. */
export function TextTabs<T extends string>({ value, options, onChange, size = 15 }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 20 }} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={{ alignItems: 'center', gap: 5 }}>
            <Txt weight={on ? 'bold' : 'semibold'} style={{ fontSize: size, color: on ? colors.text : colors.muted }}>{o.label}</Txt>
            <View style={{ height: 3, width: 16, borderRadius: 2, backgroundColor: on ? colors.brand : 'transparent' }} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small filter chips (networks etc.). */
export function Chips<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ height: 26, paddingHorizontal: 10, borderRadius: 5, justifyContent: 'center', backgroundColor: on ? colors.surface3 : colors.surface }}>
            <Txt weight="semibold" style={{ fontSize: 12, color: on ? colors.text : colors.text2 }}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Green/red buy-sell switch. */
export function SideSwitch({ value, onChange }: { value: 'buy' | 'sell'; onChange: (v: 'buy' | 'sell') => void }) {
  return (
    <View style={{ flexDirection: 'row', height: 36, borderRadius: radius.md, backgroundColor: colors.surface }}>
      {(['buy', 'sell'] as const).map((v) => {
        const on = v === value;
        return (
          <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ flex: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? (v === 'buy' ? colors.up : colors.down) : 'transparent' }}>
            <Txt weight="bold" style={{ fontSize: 14, color: on ? '#fff' : colors.text2 }}>{v === 'buy' ? 'Купить' : 'Продать'}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Notice({ text, tone = 'info' }: { text: string; tone?: 'info' | 'warn' | 'error' }) {
  const c = tone === 'error' ? colors.down : tone === 'warn' ? colors.warn : colors.brand;
  return (
    <View style={[s.notice, { borderColor: c }]}>
      <Txt style={{ color: colors.text2, fontSize: 13, lineHeight: 19 }}>{text}</Txt>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14 },
  input: {
    height: 44, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surface,
    color: colors.text, paddingHorizontal: 14, fontSize: 16, fontFamily: fonts.regular,
  },
  seg: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 2 },
  segItem: { flex: 1, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  pill: { minWidth: 74, height: 30, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  notice: { borderLeftWidth: 3, borderRadius: radius.md, padding: 10, backgroundColor: colors.surface },
});
