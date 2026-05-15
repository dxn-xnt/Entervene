import { Stack } from 'expo-router';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { DrawerProvider } from '@/context/DrawerContext';
import DrawerMenu from '@/components/student/DrawerMenu';

export default function StudentLayout() {
  return (
    <DrawerProvider>
      <View style={styles.container}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          {/* Main nav screens */}
          <Stack.Screen name="storyboard" />
          <Stack.Screen name="subjects" />
          <Stack.Screen name="grades" />
          <Stack.Screen name="todo" />
          <Stack.Screen name="notifications" />

          {/* Subject drill-down */}
          <Stack.Screen name="subject-detail" />
          <Stack.Screen name="subject-grade" />

          {/* Lesson viewer */}
          <Stack.Screen name="lesson-view" />

          {/* Classwork viewer & submission */}
          <Stack.Screen name="classwork-view" />
          <Stack.Screen name="classwork-submit" />
        </Stack>
        <DrawerMenu />
      </View>
    </DrawerProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
