import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import ClassworkItem from '@/components/student/ClassworkItem';
import { AppColors, NeoShadow, Spacing, Borders } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/hooks/api';

type LessonParams = {
  lesson_id?: string;
  class_id?: string;
  subject_id?: string;
  subject?: string;
  lessonTitle?: string;
  scheduledDate?: string;
  description?: string;
};

type LessonClasswork = {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type: string;
  total_points: number;
  due_date: string | null;
  submission_status: string | null;
};

const LessonView = () => {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<LessonParams>();

  const subjectName = params.subject ?? '';
  const lessonTitle = params.lessonTitle ?? '';
  const scheduledDate = params.scheduledDate ?? '';
  const description = params.description ?? '';
  const lessonId = params.lesson_id ? parseInt(params.lesson_id) : null;
  const classId = params.class_id ? parseInt(params.class_id) : null;

  const [classworks, setClassworks] = useState<LessonClasswork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClassworks = useCallback(async () => {
    if (!session?.token || !lessonId || !classId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const data = await apiFetch<LessonClasswork[]>(
        `/api/v1/lessons/${lessonId}/classwork-assignments?class_id=${classId}`,
        { token: session.token },
      );
      setClassworks(data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session?.token, lessonId, classId]);

  useEffect(() => { fetchClassworks(); }, [fetchClassworks]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backRow}>
          <Ionicons name="chevron-back" size={26} color={AppColors.foreground} />
          <Text style={styles.backText} numberOfLines={1}>{subjectName}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchClassworks} />}
      >
        {/* ── Lesson info card ── */}
        <View style={styles.lessonCard}>
          <View style={styles.typePill}>
            <Text style={styles.typePillText}>LESSON</Text>
          </View>
          <Text style={styles.title}>{lessonTitle}</Text>
          {description ? <Text style={styles.desc}>{description}</Text> : null}
          {scheduledDate ? (
            <View style={styles.datePill}>
              <Ionicons name="calendar-outline" size={12} color={AppColors.mutedForeground} />
              <Text style={styles.datePillText}>{scheduledDate}</Text>
            </View>
          ) : null}
        </View>

        {/* ── Classworks for this lesson ── */}
        <Text style={styles.sectionLabel}>Classworks</Text>

        {loading ? (
          <ActivityIndicator size="small" color={AppColors.primary} style={{ marginTop: 16 }} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : classworks.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="documents-outline" size={36} color={AppColors.mutedForeground} />
            <Text style={styles.emptyText}>No classworks linked to this lesson</Text>
          </View>
        ) : (
          <View style={styles.cwList}>
            {classworks.map((cw) => (
              <ClassworkItem
                key={cw.classwork_assignment_id}
                title={cw.title}
                submittedDate={
                  cw.due_date
                    ? `Due ${new Date(cw.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                    : 'No due date'
                }
                status={cw.submission_status ?? 'missing'}
                onPress={() =>
                  router.push({
                    pathname: '/student/classwork-view' as any,
                    params: { assignment_id: cw.classwork_assignment_id },
                  })
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: 14,
    borderBottomWidth: Borders.width, borderBottomColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  backText: { fontSize: 17, fontWeight: '700', color: AppColors.foreground, flex: 1 },
  content: { padding: Spacing.md, gap: 16, paddingBottom: 40 },
  lessonCard: {
    borderWidth: Borders.width, borderColor: AppColors.border, borderRadius: 10,
    padding: Spacing.md, backgroundColor: '#F6E9B2', gap: 8,
    ...NeoShadow.md,
  },
  typePill: {
    alignSelf: 'flex-start',
    backgroundColor: AppColors.primary,
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 4,
  },
  typePillText: { fontSize: 11, fontWeight: '800', color: AppColors.primaryForeground },
  title: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  desc: { fontSize: 13, color: AppColors.foreground, lineHeight: 20 },
  datePill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  datePillText: { fontSize: 12, color: AppColors.mutedForeground },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: AppColors.mutedForeground,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  cwList: { gap: 10 },
  emptyBox: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyText: { fontSize: 14, color: AppColors.mutedForeground },
  errorText: { fontSize: 13, color: AppColors.destructive },
});

export default LessonView;
