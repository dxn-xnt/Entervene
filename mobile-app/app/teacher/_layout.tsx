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
          {/* Main nav screens */}
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="classes" />
          <Stack.Screen name="classworks" />
          <Stack.Screen name="lessons" />
          <Stack.Screen name="grades" />
          <Stack.Screen name="notifications" />

          {/* Classwork creation flow */}
          <Stack.Screen name="create-classwork" />
          <Stack.Screen name="classwork-detail" />
          <Stack.Screen name="grade-submission" />
          <Stack.Screen name="submissions" />

          {/* Lesson screens */}
          <Stack.Screen name="lesson-detail" />
          <Stack.Screen name="create-lesson" />

          {/* Subject / class drill-downs */}
          <Stack.Screen name="classes-subject" />
          <Stack.Screen name="subject-detail" />
        </Stack>
        <DrawerMenu role="teacher" />
      </View>
    </DrawerProvider>
  );
}

const styles = StyleSheet.create({ container: { flex: 1 } });