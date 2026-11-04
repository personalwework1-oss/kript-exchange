import React from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Tabs } from 'expo-router/js-tabs';
import { colors, fonts } from '../../theme';

type IconName = 'home' | 'markets' | 'trade' | 'orders' | 'assets';
const icon = (name: IconName) => ({ color, focused }: { color: ColorValue; focused: boolean }) => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color as string} strokeWidth={focused ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
    {name === 'home' && <><Path d="M3 10.5 12 3l9 7.5" /><Path d="M5 9v12h14V9" /></>}
    {name === 'markets' && <><Path d="M3 3v18h18" /><Path d="m7 15 4-4 3 3 6-6" /></>}
    {name === 'trade' && <><Path d="M7 4v16" /><Path d="m3 8 4-4 4 4" /><Path d="M17 20V4" /><Path d="m21 16-4 4-4-4" /></>}
    {name === 'orders' && <><Path d="M8 6h13M8 12h13M8 18h13" /><Circle cx={3.5} cy={6} r={0.6} /><Circle cx={3.5} cy={12} r={0.6} /><Circle cx={3.5} cy={18} r={0.6} /></>}
    {name === 'assets' && <><Path d="M20 7H5a2 2 0 0 1 0-4h13v4" /><Path d="M3 5v14a2 2 0 0 0 2 2h15V7" /><Circle cx={16} cy={14} r={1.2} /></>}
  </Svg>
);

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line, height: 82, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 10 },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Главная', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="markets" options={{ title: 'Рынки', tabBarIcon: icon('markets') }} />
      <Tabs.Screen name="trade" options={{ title: 'Торговля', tabBarIcon: icon('trade') }} />
      <Tabs.Screen name="orders" options={{ title: 'Ордера', tabBarIcon: icon('orders') }} />
      <Tabs.Screen name="portfolio" options={{ title: 'Активы', tabBarIcon: icon('assets') }} />
    </Tabs>
  );
}
