import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import TabBar from '@/components/student/TabBar';
import SubjectCardHeader from '@/components/student/SubjectCardHeader';
import ClassworkItem from '@/components/student/ClassworkItem';
import { AppColors, Spacing } from '@/constants/theme';

type SubjectDetailParams = {
  subject_load_id?: string;
  subject?: string;
  teacher?: string;
  period?: string;
  section?: string;
};

const tabs = [
  { id: 'lessons', label: 'Lessons' },
  { id: 'classwork', label: 'Classwork' },
];

const SubjectDetail = () => {
  const router = useRouter();
  const params = useLocalSearchParams<SubjectDetailParams>();
  const [activeTab, setActiveTab] = useState('lessons');

  const subjectName = params.subject ?? '';
  const teacherName = params.teacher ?? '';
  const periodName  = params.period ?? '';
  const sectionName = params.section ?? '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backRow}>
          <Ionicons name="chevron-back" size={28} color={AppColors.foreground} />
          <Text style={styles.backText}>Subjects</Text>
        </TouchableOpacity>
        <Ionicons name="chevron-forward" size={24} color={AppColors.foreground} />
        <Text style={styles.subjectText} numberOfLines={1}>{subjectName}</Text>
      </View>

      {/* Period / Section info strip */}
      {(periodName || sectionName) ? (
        <View style={styles.infoStrip}>
          {periodName ? (
            <View style={styles.infoChip}>
              <Ionicons name="calendar-outline" size={12} color={AppColors.mutedForeground} />
              <Text style={styles.infoChipText}>{periodName}</Text>
            </View>
          ) : null}
          {sectionName ? (
            <View style={styles.infoChip}>
              <Ionicons name="people-outline" size={12} color={AppColors.mutedForeground} />
              <Text style={styles.infoChipText}>{sectionName}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <TabBar tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <ScrollView contentContainerStyle={styles.content}>
        {activeTab === 'lessons' && (
          <View style={styles.section}>
            <SubjectCardHeader title={subjectName} teacher={teacherName} />
          </View>
        )}
        {activeTab === 'classwork' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Classwork</Text>
            <ClassworkItem title="Assignment 2" submittedDate="October 24, 2025" status="Missing" />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  backRow:     { flexDirection: 'row', alignItems: 'center' },
  backText:    { fontSize: 22, fontWeight: '700', color: AppColors.foreground },
  subjectText: { flex: 1, fontSize: 18, color: AppColors.foreground },
  infoStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
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
  content:      { padding: Spacing.lg, gap: 16, paddingBottom: 32 },
  section:      { gap: 12 },
  sectionTitle: { fontSize: 22, fontWeight: '700', color: AppColors.foreground },
});

export default SubjectDetail;
