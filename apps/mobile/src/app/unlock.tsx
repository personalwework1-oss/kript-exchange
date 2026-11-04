import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { pinDisabled, pinWaitMs } from '@kript/wallet-core';
import { Button, Field, Notice, Screen, Txt } from '../components/ui';
import { PinPad } from '../components/PinPad';
import { colors } from '../theme';
import { PinError, useWallet } from '../wallet/WalletProvider';

function fmtWait(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Unlock() {
  const { unlockWithPassword, unlockWithBiometric, unlockWithPin, biometricEnabled, pinEnabled, pinState } = useWallet();
  const pinBlocked = pinDisabled(pinState);
  const [usePassword, setUsePassword] = useState(!pinEnabled || pinBlocked);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const wait = pinWaitMs(pinState, now);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (pinBlocked) setUsePassword(true); }, [pinBlocked]);

  const bio = async () => {
    setErr(null);
    try { await unlockWithBiometric(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  // Face ID prompt pops up by itself only when there is no PIN: with a PIN the user chooses.
  useEffect(() => { if (biometricEnabled && !pinEnabled) bio(); }, [biometricEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setBusy(true); setErr(null);
    try { await unlockWithPassword(pw); } catch { setErr('Неверный пароль'); } finally { setBusy(false); }
  };

  const onPin = async (pin: string) => {
    setBusy(true); setErr(null);
    try {
      await unlockWithPin(pin);
    } catch (e) {
      setNow(Date.now());
      if (e instanceof PinError) {
        if (e.kind === 'disabled') setErr('Слишком много попыток. Войдите по паролю.');
        else if (e.kind === 'wait') setErr(null);
        else setErr(e.attemptsLeft <= 5 ? `Неверный PIN. Осталось попыток: ${e.attemptsLeft}` : 'Неверный PIN');
      } else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!usePassword) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center', gap: 20 }}>
        <View style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <Txt weight="heavy" style={{ fontSize: 26 }}>Введите PIN</Txt>
          {wait > 0 ? <Txt style={{ color: colors.warn }}>Повторите через {fmtWait(wait)}</Txt> : <Txt style={{ color: colors.text2 }}>Разблокируйте кошелёк</Txt>}
        </View>
        <PinPad onComplete={onPin} busy={busy} disabled={wait > 0} error={err}
          extraKey={biometricEnabled ? { label: 'Face ID', onPress: bio } : undefined} />
        <Button title="Войти по паролю" kind="ghost" onPress={() => { setErr(null); setUsePassword(true); }} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} style={{ justifyContent: 'center', gap: 16 }}>
      <View style={{ gap: 8, marginBottom: 12 }}>
        <Txt weight="heavy" style={{ fontSize: 28 }}>С возвращением</Txt>
        <Txt style={{ color: colors.text2 }}>Разблокируйте кошелёк</Txt>
      </View>
      {pinBlocked ? <Notice tone="warn" text="PIN отключён после 10 неверных попыток. Войдите по паролю — PIN снова заработает." /> : null}
      <Field label="Пароль" secureTextEntry value={pw} onChangeText={setPw} onSubmitEditing={submit} autoCapitalize="none" />
      {err ? <Notice tone="error" text={err} /> : null}
      <Button title="Войти" disabled={pw.length < 8} loading={busy} onPress={submit} />
      {biometricEnabled ? <Button title="Войти по биометрии" kind="ghost" onPress={bio} /> : null}
      {pinEnabled && !pinBlocked ? <Button title="Войти по PIN" kind="ghost" onPress={() => { setErr(null); setUsePassword(false); }} /> : null}
    </Screen>
  );
}
