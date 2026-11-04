import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { generateMnemonic } from '@kript/wallet-core';
import { Button, Notice, Screen, Txt, Mono } from '../../components/ui';
import { SecureStep } from '../../components/SecureStep';
import { colors } from '../../theme';

type Step = 'intro' | 'phrase' | 'verify' | 'secure';

function pickChecks(n: number): number[] {
  const idx = new Set<number>();
  const r = new Uint32Array(8);
  crypto.getRandomValues(r);
  for (const v of r) {
    idx.add(v % n);
    if (idx.size === 3) break;
  }
  return [...idx].sort((a, b) => a - b);
}

export default function CreateWallet() {
  const mnemonic = useMemo(() => generateMnemonic(12), []);
  const words = mnemonic.split(' ');
  const checks = useMemo(() => pickChecks(words.length), [words.length]);
  const [step, setStep] = useState<Step>('intro');
  const [answers, setAnswers] = useState<Record<number, string>>({});

  // 6 options per checked word: the right one + 5 other words of the phrase/list
  const options = useMemo(() => {
    const pool = [...new Set(words)];
    return Object.fromEntries(checks.map((i) => {
      const others = pool.filter((w) => w !== words[i]).sort(() => Math.random() - 0.5).slice(0, 5);
      return [i, [...others, words[i]!].sort()];
    }));
  }, [checks, words]);

  const verified = checks.every((i) => answers[i] === words[i]);

  if (step === 'secure') return <Screen><SecureStep mnemonic={mnemonic} /></Screen>;

  return (
    <Screen>
      {step === 'intro' && (
        <View style={{ gap: 16, paddingTop: 24 }}>
          <Txt weight="heavy" style={{ fontSize: 26 }}>Резервная фраза</Txt>
          <Txt style={{ color: colors.text2, lineHeight: 22 }}>
            Сейчас вы увидите 12 слов. Это единственный способ восстановить кошелёк, если телефон потеряется.
          </Txt>
          <Notice tone="warn" text="Запишите слова на бумаге. Не делайте скриншот и не храните в заметках или мессенджерах. Кто знает эти слова, тот владеет деньгами." />
          <Button title="Показать слова" onPress={() => setStep('phrase')} />
        </View>
      )}

      {step === 'phrase' && (
        <View style={{ gap: 18 }}>
          <Txt weight="heavy" style={{ fontSize: 24 }}>Запишите по порядку</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {words.map((w, i) => (
              <View key={i} style={{ width: '31%', flexDirection: 'row', gap: 6, padding: 10, borderRadius: 12, backgroundColor: colors.surface }}>
                <Mono style={{ color: colors.muted, fontSize: 12 }}>{i + 1}</Mono>
                <Txt weight="semibold" style={{ fontSize: 14 }}>{w}</Txt>
              </View>
            ))}
          </View>
          <Button title="Я записал(а)" onPress={() => setStep('verify')} />
        </View>
      )}

      {step === 'verify' && (
        <View style={{ gap: 18 }}>
          <Txt weight="heavy" style={{ fontSize: 24 }}>Проверим</Txt>
          {checks.map((i) => (
            <View key={i} style={{ gap: 8 }}>
              <Txt style={{ color: colors.text2 }}>Слово №{i + 1}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {options[i]!.map((w) => {
                  const sel = answers[i] === w;
                  return (
                    <Pressable key={w} onPress={() => setAnswers((a) => ({ ...a, [i]: w }))} accessibilityRole="button"
                      style={{ paddingHorizontal: 14, height: 40, justifyContent: 'center', borderRadius: 12, borderWidth: 1,
                        borderColor: sel ? colors.brand : colors.line2, backgroundColor: sel ? colors.brandSoft : 'transparent' }}>
                      <Txt weight="semibold" style={{ fontSize: 14 }}>{w}</Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {Object.keys(answers).length === checks.length && !verified ? <Notice tone="error" text="Есть ошибка. Сверьтесь с записью." /> : null}
          <Button title="Продолжить" disabled={!verified} onPress={() => setStep('secure')} />
          <Button title="Показать слова ещё раз" kind="ghost" onPress={() => setStep('phrase')} />
        </View>
      )}
    </Screen>
  );
}
