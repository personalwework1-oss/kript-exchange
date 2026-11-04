import React, { useState } from 'react';
import { View } from 'react-native';
import { isValidMnemonic, normalizeMnemonic } from '@kript/wallet-core';
import { Button, Field, Screen, Txt } from '../../components/ui';
import { SecureStep } from '../../components/SecureStep';
import { colors } from '../../theme';

export default function ImportWallet() {
  const [text, setText] = useState('');
  const [phrase, setPhrase] = useState<string | null>(null);
  const n = normalizeMnemonic(text).split(' ').filter(Boolean).length;
  const valid = isValidMnemonic(text);

  if (phrase) return <Screen><SecureStep mnemonic={phrase} /></Screen>;
  return (
    <Screen>
      <View style={{ gap: 16, paddingTop: 24 }}>
        <Txt weight="heavy" style={{ fontSize: 26 }}>Импорт кошелька</Txt>
        <Txt style={{ color: colors.text2, lineHeight: 21 }}>
          Введите 12 или 24 слова через пробел. Подойдёт фраза из MetaMask, Trust Wallet, Phantom и других кошельков.
        </Txt>
        <Field label="Сид-фраза" value={text} onChangeText={setText} multiline autoCapitalize="none" autoCorrect={false}
          style={{ height: 120, textAlignVertical: 'top', paddingTop: 12 }}
          error={n >= 12 && !valid ? 'Фраза неверная: проверьте слова и порядок' : null} />
        <Button title="Продолжить" disabled={!valid} onPress={() => setPhrase(normalizeMnemonic(text))} />
      </View>
    </Screen>
  );
}
