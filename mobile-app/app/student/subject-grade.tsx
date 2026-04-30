import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors, Spacing } from '@/constants/theme';

const SubjectGrade = () => {
  const router = useRouter();
  const { subject } = useLocalSearchParams<{ subject: string }>();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backRow}>
          <Ionicons name="chevron-back" size={28} color={AppColors.foreground} />
          <Text style={styles.backText}>Grades</Text>
        </TouchableOpacity>
        <Ionicons name="chevron-forward" size={24} color={AppColors.foreground} />
        <Text style={styles.subjectText}>{subject}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.placeholder}>Grade details for {subject} will appear here.</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: AppColors.mutedForeground,
  },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backText: { fontSize: 22, fontWeight: '700', color: AppColors.foreground },
  subjectText: { fontSize: 20, color: AppColors.foreground },
  content: { padding: Spacing.lg },
  placeholder: { fontSize: 14, color: AppColors.mutedForeground },
});

export default SubjectGrade;
