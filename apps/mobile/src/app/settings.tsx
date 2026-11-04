import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Field, Mono, Notice, Screen, Txt } from '../components/ui';
import { colors } from '../theme';
import { NETWORK } from '../config';
import { PinError, useWallet } from '../wallet/WalletProvider';

function Row({ title, value, onPress }: { title: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
      <Txt weight="semibold">{title}</Txt>
      <Txt style={{ color: colors.muted }}>{value} ›</Txt>
    </Pressable>
  );
}

export default function Settings() {
  const { lock, deleteWallet, revealMnemonic, biometricEnabled, pinEnabled, decoyEnabled } = useWallet();
  const [byPin, setByPin] = useState(pinEnabled);
  const [secret, setSecret] = useState('');
  const [phrase, setPhrase] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reveal = async () => {
    setBusy(true); setErr(null);
    try {
      setPhrase(await revealMnemonic(byPin ? { pin: secret } : { password: secret }));
      setSecret('');
    } catch (e) {
      if (e instanceof PinError) setErr(e.kind === 'disabled' ? 'PIN отключён — используйте пароль' : e.kind === 'wait' ? 'Слишком много попыток, подождите' : 'Неверный PIN');
      else setErr(byPin ? 'Неверный PIN' : 'Неверный пароль');
    } finally { setBusy(false); }
  };

  const remove = () =>
    Alert.alert('Удалить кошелёк с телефона?', 'Без записанной сид-фразы доступ к деньгам будет потерян навсегда.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteWallet() },
    ]);

  return (
    <Screen>
      <View style={{ gap: 16 }}>
        <Txt weight="heavy" style={{ fontSize: 24 }}>Настройки</Txt>
        <Card style={{ gap: 6 }}>
          <Txt style={{ color: colors.muted, fontSize: 13 }}>Режим сети</Txt>
          <Txt weight="semibold">{NETWORK === 'mainnet' ? 'Основные сети' : 'Тестовые сети'}</Txt>
          <Txt style={{ color: colors.muted, fontSize: 13 }}>Вход по биометрии: {biometricEnabled ? 'включён' : 'выключен'}</Txt>
        </Card>

        <Txt weight="bold" style={{ fontSize: 16, marginTop: 8 }}>Вход</Txt>
        <Card style={{ paddingVertical: 4 }}>
          <Row title="PIN-код" value={pinEnabled ? 'Включён' : 'Выключен'} onPress={() => router.push('/pin-setup')} />
          <View style={{ height: 1, backgroundColor: colors.line }} />
          <Row title="Ложный PIN" value={decoyEnabled ? 'Включён' : 'Не настроен'} onPress={() => router.push('/decoy')} />
        </Card>

        <Txt weight="bold" style={{ fontSize: 16, marginTop: 8 }}>Сид-фраза</Txt>
        {phrase ? (
          <Card style={{ gap: 10 }}>
            <Mono style={{ lineHeight: 22 }}>{phrase}</Mono>
            <Button title="Скрыть" kind="secondary" onPress={() => setPhrase(null)} />
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            {byPin ? (
              <Field label="PIN" secureTextEntry keyboardType="number-pad" maxLength={6} value={secret} onChangeText={(t) => setSecret(t.replace(/\D/g, ''))} />
            ) : (
              <Field label="Пароль" secureTextEntry value={secret} onChangeText={setSecret} autoCapitalize="none" />
            )}
            {err ? <Notice tone="error" text={err} /> : null}
            <Button title="Показать сид-фразу" kind="secondary" disabled={byPin ? secret.length !== 6 : secret.length < 8} loading={busy} onPress={reveal} />
            {pinEnabled ? (
              <Button title={byPin ? 'Ввести пароль вместо PIN' : 'Ввести PIN вместо пароля'} kind="ghost"
                onPress={() => { setByPin(!byPin); setSecret(''); setErr(null); }} />
            ) : null}
          </View>
        )}

        <Button title="Заблокировать" kind="ghost" style={{ marginTop: 12 }} onPress={() => { lock(); }} />
        <Button title="Удалить кошелёк с устройства" kind="down" onPress={remove} />
        <Button title="Назад" kind="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
