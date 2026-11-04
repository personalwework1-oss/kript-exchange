import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Field, Notice, Screen, Txt } from '../components/ui';
import { NewPinFlow } from '../components/PinPad';
import { colors } from '../theme';
import { useWallet } from '../wallet/WalletProvider';

/**
 * Decoy PIN: a second PIN that opens a separate, almost empty wallet.
 * For when someone forces you to unlock the phone.
 */
export default function Decoy() {
  const { pinEnabled, decoyEnabled, setDecoyPin } = useWallet();
  const [mode, setMode] = useState<'info' | 'set' | 'off'>('info');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = () => router.back();

  if (mode === 'set') {
    return (
      <Screen>
        <NewPinFlow title="Ложный PIN" askPassword hint="Подтвердите паролем кошелька, затем придумайте ложный PIN — он должен отличаться от настоящего."
          onSave={async (pin, password) => { await setDecoyPin(password, pin); setMode('info'); }} onCancel={() => setMode('info')} />
      </Screen>
    );
  }

  if (mode === 'off') {
    const off = async () => {
      setBusy(true); setErr(null);
      try { await setDecoyPin(pw, null); setPw(''); setMode('info'); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    };
    return (
      <Screen>
        <View style={{ gap: 16 }}>
          <Txt weight="heavy" style={{ fontSize: 24 }}>Удалить ложный PIN</Txt>
          <Notice tone="warn" text="Второй кошелёк будет стёрт с телефона. Если на нём есть деньги — сначала переведите их или запишите его сид-фразу." />
          <Field label="Пароль кошелька" secureTextEntry value={pw} onChangeText={setPw} autoCapitalize="none" />
          {err ? <Notice tone="error" text={err} /> : null}
          <Button title="Удалить" kind="down" disabled={pw.length < 8} loading={busy} onPress={off} />
          <Button title="Отмена" kind="ghost" onPress={() => setMode('info')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: 16 }}>
        <Txt weight="heavy" style={{ fontSize: 24 }}>Ложный PIN</Txt>
        <Txt style={{ color: colors.text2, lineHeight: 21 }}>
          Если вас заставляют открыть кошелёк — введите ложный PIN. Откроется отдельный кошелёк со своими адресами
          и балансом. Внешне он ничем не отличается от настоящего, и по приложению нельзя понять, что есть второй.
        </Txt>
        <Card style={{ gap: 6 }}>
          <Txt style={{ color: colors.muted, fontSize: 13 }}>Статус</Txt>
          <Txt weight="semibold">{decoyEnabled ? 'Включён' : 'Не настроен'}</Txt>
        </Card>
        <Notice tone="warn" text={
          'Чтобы это работало:\n' +
          '• положите на ложный кошелёк немного денег — пустой выглядит подозрительно;\n' +
          '• выключите вход по Face ID / отпечатку: он всегда открывает настоящий кошелёк;\n' +
          '• пароль кошелька всегда открывает настоящий — его не называйте.\n' +
          'Сид-фразу ложного кошелька можно посмотреть в настройках, войдя по ложному PIN.'
        } />
        {!pinEnabled ? (
          <>
            <Notice text="Сначала включите обычный PIN-код." />
            <Button title="Включить PIN" onPress={() => router.replace('/pin-setup')} />
          </>
        ) : decoyEnabled ? (
          <Button title="Удалить ложный PIN" kind="ghost" onPress={() => setMode('off')} />
        ) : (
          <Button title="Настроить ложный PIN" onPress={() => setMode('set')} />
        )}
        <Button title="Назад" kind="ghost" onPress={done} />
      </View>
    </Screen>
  );
}
