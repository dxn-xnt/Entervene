import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { AppColors } from '@/constants/theme';

export const unstable_settings = {
  initialRouteName: 'login',
};

/**
 * Inner navigator that redirects based on auth state.
 * If the user is logged in → go to (tabs).
 * If not → go to login.
 */
function RootNavigator() {
  const { role, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'login';
    const inStudentGroup = segments[0] === 'student';
    const inTeacherGroup = segments[0] === 'teacher';

    if (!role && !inAuthGroup) {
      // Not logged in and not on login screen → redirect to login
      router.replace('/login');
    } else if (role && inAuthGroup) {
      // Logged in but on login screen → redirect based on role
      if (role === 'student') {
        router.replace('/student/storyboard' as any);
      } else if (role === 'teacher') {
        router.replace('/teacher/dashboard' as any);
      } else {
        router.replace('/(tabs)');
      }
    } else if (role === 'student' && !inStudentGroup && !inAuthGroup) {
      // Student logged in but not on student route → redirect to student area
      router.replace('/student/storyboard' as any);
    } else if (role === 'teacher' && !inTeacherGroup && !inAuthGroup) {
      // Teacher logged in but not on teacher route → redirect to teacher area
      router.replace('/teacher/dashboard' as any);
    }
  }, [role, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={AppColors.primary} />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="student" options={{ headerShown: false }} />
        <Stack.Screen name="teacher" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: AppColors.background,
  },
});
