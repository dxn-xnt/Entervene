import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import TabBar from '@/components/student/TabBar';
import SubjectCardHeader from '@/components/student/SubjectCardHeader';
import ClassworkItem from '@/components/student/ClassworkItem';
import { AppColors, NeoShadow, Spacing } from '@/constants/theme';
import ScreenHeader from '@/components/student/ScreenHeader';

type ClassworkParams = {
  classworkId: string;
  lessonName?: string;
  description?: string;
  title: string,
  scheduledDate: string,
  dueDate: string,
  attachments?: string[],
};

const ClassworkView = () => {
  const router = useRouter();
  const params = useLocalSearchParams<ClassworkParams>();

  const classworkTitle = params.title ?? '';
  const lessonName = params.lessonName ?? '';
  const scheduledDate = params.scheduledDate ?? '';
  const dueDate = params.dueDate ?? '';
  const description = params.description ?? '';
  const attachments = params.attachments ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backRow}>
          <Ionicons name="chevron-back" size={28} color={AppColors.foreground} />
          <Text style={styles.backText}>{lessonName}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.content}>
        <View style={styles.left}>
          <Text style={styles.title}>{classworkTitle}</Text>
          <Text style={styles.teacher}>{description}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    backgroundColor: AppColors.card,
    borderBottomColor: AppColors.border,
  },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backText: { fontSize: 22, fontWeight: '700', color: AppColors.foreground },
  subjectText: { flex: 1, fontSize: 18, color: AppColors.foreground },
  infoStrip: {
    flexDirection: 'row',
    gap: 8,
  },
  infoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: AppColors.muted,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  infoChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: AppColors.mutedForeground,
  },
  content: { paddingHorizontal: Spacing.md, gap: 16, paddingBottom: 32 },
  section: { gap: 16, paddingHorizontal: Spacing.md },
  sectionTitle: { fontSize: 22, fontWeight: '700', color: AppColors.foreground },
  subjectHeader: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: AppColors.border,
    borderRadius: 8,
    backgroundColor: '#F6E9B2',
    shadowColor: AppColors.black,
    marginHorizontal: 16,
    marginBottom: 20,
    gap: 8,
    ...NeoShadow.lg,
  },
  left: {
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  teacher: {
    fontSize: 13,
    color: AppColors.foreground,
  },
});

export default ClassworkView;
