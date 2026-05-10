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

type LessonParams = {
  subject_load_id?: string;
  subject?: string;
  lessonTitle: string,
  scheduledDate: string,
  description: string,
};

const LessonView = () => {
  const router = useRouter();
  const params = useLocalSearchParams<LessonParams>();

  const subjectName = params.subject ?? '';
  const lessonTitle = params.lessonTitle ?? '';
  const scheduledDate = params.scheduledDate ?? '';
  const description = params.description ?? '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backRow}>
          <Ionicons name="chevron-back" size={28} color={AppColors.foreground} />
          <Text style={styles.backText}>{subjectName}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.subjectHeader}>
        <View style={styles.left}>
          <Text style={styles.title}>{lessonTitle}</Text>
          <Text style={styles.teacher}>{description}</Text>
        </View>

        {/* Period / Section info strip */}
        {(scheduledDate) ? (
          <View style={styles.infoStrip}>
            {scheduledDate ? (
              <View style={styles.infoChip}>
                <Ionicons name="calendar-outline" size={12} color={AppColors.mutedForeground} />
                <Text style={styles.infoChipText}>{scheduledDate}</Text>
              </View>
            ) : null}

          </View>
        ) : null}
      </View>
      <View style={styles.section}>
        <ClassworkItem title="Assignment 2" submittedDate="October 24, 2025" status="Missing" />
        <ClassworkItem title="Assignment 2" submittedDate="October 24, 2025" status="Missing" />
        <ClassworkItem title="Assignment 2" submittedDate="October 24, 2025" status="Missing" />
        <ClassworkItem title="Assignment 2" submittedDate="October 24, 2025" status="Missing" />
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
  content: { padding: Spacing.md, gap: 16, paddingBottom: 32 },
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

export default LessonView;
