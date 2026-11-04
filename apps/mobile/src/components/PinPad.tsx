import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { isWeakPin } from '@kript/wallet-core';
import { Button, Field, Notice, Txt } from './ui';
import { colors } from '../theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'extra', '0', 'del'] as const;

/**
 * 6-digit PIN entry: dots + on-screen keypad (no system keyboard, no autofill/suggestions).
 * `onComplete` gets the PIN when the 6th digit is typed; the pad clears itself afterwards.
 */
export function PinPad({
  onComplete, disabled, busy, extraKey, error,
}: {
  onComplete: (pin: string) => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  /** Bottom-left key, e.g. biometrics. */
  extraKey?: { label: string; onPress: () => void };
  error?: string | null;
}) {
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (pin.length !== 6) return;
    const p = pin;
    Promise.resolve(onComplete(p)).finally(() => setPin(''));
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  const press = (k: (typeof KEYS)[number]) => {
    if (k === 'extra') return extraKey?.onPress();
    if (disabled || busy) return;
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    setPin((p) => (p.length < 6 ? p + k : p));
  };

  return (
    <View style={{ gap: 22, alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', gap: 14, height: 18 }} accessibilityLabel={`Введено цифр: ${pin.length} из 6`}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={{
            width: 14, height: 14, borderRadius: 7, borderWidth: 1.5,
            borderColor: error ? colors.down : colors.line2,
            backgroundColor: i < pin.length || busy ? colors.brand : 'transparent',
          }} />
        ))}
      </View>
      <Txt style={{ color: error ? colors.down : colors.muted, fontSize: 13, minHeight: 18, textAlign: 'center' }}>{error ?? ' '}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: 288, rowGap: 14, columnGap: 24, opacity: disabled ? 0.4 : 1 }}>
        {KEYS.map((k) => {
          if (k === 'extra' && !extraKey) return <View key={k} style={{ width: 80, height: 64 }} />;
          const label = k === 'del' ? '⌫' : k === 'extra' ? extraKey!.label : k;
          return (
            <Pressable key={k} onPress={() => press(k)} accessibilityRole="button" accessibilityLabel={k === 'del' ? 'Стереть' : label}
              style={({ pressed }) => ({
                width: 80, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
                backgroundColor: k === 'del' || k === 'extra' ? 'transparent' : pressed ? colors.surface2 : colors.surface,
              })}>
              <Txt weight={k === 'extra' ? 'semibold' : 'bold'} style={{ fontSize: k === 'extra' ? 13 : 26, color: k === 'extra' ? colors.brand : colors.text }}>{label}</Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * "Choose a new PIN": enter + repeat, refuses guessable PINs.
 * Optionally asks for the password first (changing security settings of an existing wallet).
 */
export function NewPinFlow({
  title, hint, askPassword, onSave, onCancel,
}: {
  title: string;
  hint?: string;
  askPassword: boolean;
  onSave: (pin: string, password: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState<'password' | 'new' | 'repeat'>(askPassword ? 'password' : 'new');
  const [password, setPassword] = useState('');
  const [first, setFirst] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFirst = (p: string) => {
    if (isWeakPin(p)) return setErr('Слишком простой PIN — его легко угадать');
    setErr(null);
    setFirst(p);
    setStep('repeat');
  };
  const onRepeat = async (p: string) => {
    if (p !== first) {
      setErr('PIN не совпал, придумайте заново');
      setStep('new');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave(p, password);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setStep(msg === 'Неверный пароль' && askPassword ? 'password' : 'new');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'password') {
    return (
      <View style={{ gap: 16 }}>
        <Txt weight="heavy" style={{ fontSize: 24 }}>{title}</Txt>
        {hint ? <Txt style={{ color: colors.text2, lineHeight: 21 }}>{hint}</Txt> : null}
        <Field label="Пароль кошелька" secureTextEntry value={password} onChangeText={setPassword} autoCapitalize="none" />
        {err ? <Notice tone="error" text={err} /> : null}
        <Button title="Далее" disabled={password.length < 8} onPress={() => { setErr(null); setStep('new'); }} />
        {onCancel ? <Button title="Отмена" kind="ghost" onPress={onCancel} /> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 18, alignItems: 'center' }}>
      <Txt weight="heavy" style={{ fontSize: 24, textAlign: 'center' }}>{step === 'new' ? title : 'Повторите PIN'}</Txt>
      {step === 'new' && hint && !askPassword ? <Txt style={{ color: colors.text2, textAlign: 'center', lineHeight: 21 }}>{hint}</Txt> : null}
      <PinPad key={step} onComplete={step === 'new' ? onFirst : onRepeat} busy={busy} error={err} />
      {onCancel ? <Button title="Отмена" kind="ghost" style={{ alignSelf: 'stretch' }} onPress={onCancel} /> : null}
    </View>
  );
}
