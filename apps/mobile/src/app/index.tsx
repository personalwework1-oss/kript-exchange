import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '../theme';

/** Placeholder while <Gate/> decides where to go. */
export default function Index() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}
