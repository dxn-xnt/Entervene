import { Stack } from 'expo-router';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { DrawerProvider } from '@/context/DrawerContext';
import DrawerMenu from '@/components//DrawerMenu';

export default function TeacherLayout() {
  return (
    <DrawerProvider>
      <View style={styles.container}>
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="classes" />
          <Stack.Screen name="classworks" />
          <Stack.Screen name="new-classwork-form" />
          <Stack.Screen name="create-classwork-material" />
          <Stack.Screen name="interventions" />
          <Stack.Screen name="grades" />
          <Stack.Screen name="notifications" />
        </Stack>
        <DrawerMenu role="teacher" />
      </View>
    </DrawerProvider>
  );
}

const styles = StyleSheet.create({ container: { flex: 1 } });