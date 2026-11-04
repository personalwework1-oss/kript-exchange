import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Field, Notice, Screen, Txt } from '../components/ui';
import { NewPinFlow } from '../components/PinPad';
import { colors } from '../theme';
import { useWallet } from '../wallet/WalletProvider';

/** Turn on / change / turn off the unlock PIN. Always asks for the wallet password. */
export default function PinSetup() {
  const { pinEnabled, setPin } = useWallet();
  const [mode, setMode] = useState<'menu' | 'set' | 'off'>(pinEnabled ? 'menu' : 'set');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const done = () => router.back();

  if (mode === 'set') {
    return (
      <Screen>
        <NewPinFlow title={pinEnabled ? 'Новый PIN' : 'Придумайте PIN'} askPassword
          hint="Подтвердите паролем кошелька, затем введите 6 цифр."
          onSave={async (pin, password) => { await setPin(password, pin); done(); }} onCancel={done} />
      </Screen>
    );
  }

  if (mode === 'off') {
    const off = async () => {
      setBusy(true); setErr(null);
      try { await setPin(pw, null); done(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    };
    return (
      <Screen>
        <View style={{ gap: 16 }}>
          <Txt weight="heavy" style={{ fontSize: 24 }}>Отключить PIN</Txt>
          <Notice tone="warn" text="Вход будет только по паролю или биометрии. Ложный PIN тоже будет удалён." />
          <Field label="Пароль кошелька" secureTextEntry value={pw} onChangeText={setPw} autoCapitalize="none" />
          {err ? <Notice tone="error" text={err} /> : null}
          <Button title="Отключить" kind="down" disabled={pw.length < 8} loading={busy} onPress={off} />
          <Button title="Отмена" kind="ghost" onPress={done} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: 16 }}>
        <Txt weight="heavy" style={{ fontSize: 24 }}>PIN-код</Txt>
        <Txt style={{ color: colors.text2, lineHeight: 21 }}>
          PIN работает только на этом телефоне: он смешивается с секретом, который никогда не покидает устройство.
          После 5 ошибок появляются паузы, после 10 — PIN отключается до входа по паролю.
        </Txt>
        <Button title="Изменить PIN" kind="secondary" onPress={() => setMode('set')} />
        <Button title="Отключить PIN" kind="ghost" onPress={() => setMode('off')} />
        <Button title="Назад" kind="ghost" onPress={done} />
      </View>
    </Screen>
  );
}
