import '../polyfills';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, router, useSegments, SplashScreen } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { InterTight_500Medium, InterTight_600SemiBold, InterTight_700Bold, InterTight_800ExtraBold } from '@expo-google-fonts/inter-tight';
import { JetBrainsMono_600SemiBold, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { WalletProvider, useWallet } from '../wallet/WalletProvider';
import { colors } from '../theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Sends the user to onboarding / unlock / the app depending on wallet state. */
function Gate() {
  const { status } = useWallet();
  const segments = useSegments();
  useEffect(() => {
    if (status === 'loading') return;
    SplashScreen.hideAsync().catch(() => {});
    const top = segments[0] as string | undefined;
    if (status === 'none' && top !== 'onboarding') router.replace('/onboarding');
    else if (status === 'locked' && top !== 'unlock') router.replace('/unlock');
    else if (status === 'unlocked' && (top === 'onboarding' || top === 'unlock' || top === undefined)) router.replace('/home');
  }, [status, segments]);
  return null;
}

export default function RootLayout() {
  const [loaded] = useFonts({
    InterTight_500Medium, InterTight_600SemiBold, InterTight_700Bold, InterTight_800ExtraBold,
    JetBrainsMono_600SemiBold, JetBrainsMono_700Bold,
  });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return (
    <WalletProvider>
      <StatusBar style="light" />
      <Gate />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="unlock" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="receive" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="send" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="coin" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="pin-setup" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="decoy" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="add-token" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
    </WalletProvider>
  );
}
