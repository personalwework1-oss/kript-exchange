import React, { useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Field, Notice, Txt } from './ui';
import { colors } from '../theme';
import { useWallet } from '../wallet/WalletProvider';
import { NewPinFlow } from './PinPad';

/** Last onboarding step: choose a password (+ optional biometrics) and create the vault. */
export function SecureStep({ mnemonic }: { mnemonic: string }) {
  const { createWallet, biometricAvailable } = useWallet();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [bio, setBio] = useState(biometricAvailable);
  const [usePin, setUsePin] = useState(true);
  const [pinStep, setPinStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pwErr = pw && pw.length < 8 ? 'Минимум 8 символов' : null;
  const matchErr = pw2 && pw2 !== pw ? 'Пароли не совпадают' : null;
  const ok = pw.length >= 8 && pw === pw2;

  const create = async (pin?: string) => {
    setBusy(true);
    setErr(null);
    try {
      await createWallet(mnemonic, pw, { biometric: bio, pin });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setPinStep(false);
    }
  };
  const submit = () => (usePin ? setPinStep(true) : create());

  if (pinStep) {
    return (
      <NewPinFlow title="Придумайте PIN" hint="6 цифр для быстрого входа. Пароль останется запасным способом."
        askPassword={false} onSave={(pin) => create(pin)} onCancel={() => setPinStep(false)} />
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <Txt weight="heavy" style={{ fontSize: 26 }}>Защитите кошелёк</Txt>
      <Txt style={{ color: colors.text2, lineHeight: 21 }}>
        Пароль шифрует сид-фразу на этом телефоне. Мы его не знаем и не сможем восстановить.
      </Txt>
      <Field label="Пароль" secureTextEntry value={pw} onChangeText={setPw} error={pwErr} autoCapitalize="none" textContentType="newPassword" />
      <Field label="Повторите пароль" secureTextEntry value={pw2} onChangeText={setPw2} error={matchErr} autoCapitalize="none" />
      {biometricAvailable ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Txt weight="semibold">Вход по Face ID / отпечатку</Txt>
            <Txt style={{ color: colors.muted, fontSize: 13 }}>Пароль останется запасным способом</Txt>
          </View>
          <Switch value={bio} onValueChange={setBio} trackColor={{ true: colors.brand, false: colors.line2 }} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Txt weight="semibold">Вход по PIN-коду</Txt>
          <Txt style={{ color: colors.muted, fontSize: 13 }}>6 цифр вместо пароля. После 10 ошибок — только пароль</Txt>
        </View>
        <Switch value={usePin} onValueChange={setUsePin} trackColor={{ true: colors.brand, false: colors.line2 }} />
      </View>
      {err ? <Notice tone="error" text={err} /> : null}
      <Button title={usePin ? 'Далее' : 'Создать кошелёк'} disabled={!ok} loading={busy} onPress={submit} />
    </View>
  );
}
