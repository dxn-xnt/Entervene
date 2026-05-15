import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors, NeoShadow, Spacing, Borders } from '@/constants/theme';
import TabBar from '@/components/student/TabBar';
import LessonCard from '@/components/student/LessonCard';
import ClassworkItem from '@/components/student/ClassworkItem';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/hooks/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type LessonAttachment = {
  lesson_attachment_id: number;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
};

type Lesson = {
  lesson_id: number;
  title: string;
  description: string | null;
  content: string | null;
  order_index: number;
  is_published: boolean;
  subject_id: number;
  subject_name: string | null;
  created_by_staff_id: string;
  teacher_name: string | null;
  attachments: LessonAttachment[];
  created_at: string;
  updated_at: string;
};

type ClassworkAssignment = {
  classwork_assignment_id: number;
  classwork_id: number;
  class_id: number;
  section_name: string | null;
  title: string;
  description: string | null;
  classwork_type: string;
  classwork_category: string | null;
  total_points: number | null;
  due_date: string | null;
  is_published: boolean;
  teacher_name: string | null;
  submission_status: string | null;
};

type Params = {
  subject_load_id?: string;
  class_id?: string;
  subject_id?: string;
  subject?: string;
  teacher?: string;
  period?: string;
  section?: string;
};

const TABS = [
  { id: 'lessons', label: 'Lessons' },
  { id: 'classwork', label: 'Classwork' },
];

const BANNER_BG = "#F6E9B2";
const ACTION_GREEN = "#7ABA78";
const TAG_GREEN_BG = "#dcfce7";
const TAG_GREEN_TEXT = "#166534";

// ── Component ─────────────────────────────────────────────────────────────────

export default function SubjectDetail() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const { session } = useAuth();
  const [activeTab, setActiveTab] = useState('lessons');

  const classId = params.class_id ? Number(params.class_id) : null;
  const subjectId = params.subject_id ? Number(params.subject_id) : null;

  // ── Lessons state ──
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonsError, setLessonsError] = useState<string | null>(null);

  // ── Classwork state ──
  const [classworks, setClassworks] = useState<ClassworkAssignment[]>([]);
  const [classworkLoading, setClassworkLoading] = useState(false);
  const [classworkError, setClassworkError] = useState<string | null>(null);

  // ── Fetch lessons ──
  const fetchLessons = useCallback(async () => {
    if (!session?.token || !classId || !subjectId) return;
    setLessonsLoading(true);
    setLessonsError(null);
    try {
      const data = await apiFetch<Lesson[]>(
        `/api/v1/lessons/class/${classId}/subject/${subjectId}`,
        { token: session.token },
      );
      setLessons(data);
    } catch (e: any) {
      setLessonsError(e.message ?? 'Failed to load lessons');
    } finally {
      setLessonsLoading(false);
    }
  }, [session?.token, classId, subjectId]);

  // ── Fetch classworks ──
  const fetchClassworks = useCallback(async () => {
    if (!session?.token || !classId || !subjectId) return;
    setClassworkLoading(true);
    setClassworkError(null);
    try {
      const data = await apiFetch<ClassworkAssignment[]>(
        `/api/v1/classwork-assignments/class/${classId}/subject/${subjectId}`,
        { token: session.token },
      );
      setClassworks(data);
    } catch (e: any) {
      setClassworkError(e.message ?? 'Failed to load classwork');
    } finally {
      setClassworkLoading(false);
    }
  }, [session?.token, classId, subjectId]);

  useEffect(() => { fetchLessons(); }, [fetchLessons]);
  useEffect(() => { fetchClassworks(); }, [fetchClassworks]);

  const onRefresh = () => {
    fetchLessons();
    fetchClassworks();
  };

  const isRefreshing = lessonsLoading || classworkLoading;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Back header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backRow}>
          <Ionicons name="chevron-back" size={28} color={AppColors.foreground} />
          <Text style={styles.backText}>Subjects</Text>
        </TouchableOpacity>
      </View>

      {/* Subject info card */}
      <View style={styles.subjectBanner}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{params.subject}</Text>
          <Text style={styles.bannerSub}>
            {params.section ? `${params.section} · ` : ""}
          </Text>
        </View>
        <Ionicons
          name="information-circle-outline"
          size={22}
          color={AppColors.mutedForeground}
        />
      </View>

      <TabBar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        {/* ── LESSONS TAB ── */}
        {activeTab === 'lessons' && (
          <View style={styles.section}>
            {!classId || !subjectId ? (
              <Text style={styles.hint}>Subject info missing — go back and reopen.</Text>
            ) : lessonsLoading ? (
              <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 32 }} />
            ) : lessonsError ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>{lessonsError}</Text>
                <TouchableOpacity onPress={fetchLessons} style={styles.retryBtn}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : lessons.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="book-outline" size={40} color={AppColors.mutedForeground} />
                <Text style={styles.emptyText}>No lessons published yet.</Text>
              </View>
            ) : (
              lessons.map((l) => (
                <LessonCard
                  key={l.lesson_id}
                  lessonTitle={l.title}
                  scheduledDate={new Date(l.created_at).toLocaleDateString('en-US', {
                    month: 'long', day: 'numeric', year: 'numeric',
                  })}
                  onPress={() =>
                    router.push({
                      pathname: '/student/lesson-view' as any,
                      params: {
                        lesson_id: l.lesson_id,
                        class_id: classId,        // ← add this
                        subject_id: subjectId,      // ← add this too (good to have)
                        subject: params.subject,
                        lessonTitle: l.title,
                        description: l.description ?? '',
                        scheduledDate: new Date(l.created_at).toLocaleDateString('en-US', {
                          month: 'long', day: 'numeric', year: 'numeric',
                        }),
                      },
                    })
                  }
                />
              ))
            )}
          </View>
        )}

        {/* ── CLASSWORK TAB ── */}
        {activeTab === 'classwork' && (
          <View style={styles.section}>
            {!classId || !subjectId ? (
              <Text style={styles.hint}>Subject info missing — go back and reopen.</Text>
            ) : classworkLoading ? (
              <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 32 }} />
            ) : classworkError ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>{classworkError}</Text>
                <TouchableOpacity onPress={fetchClassworks} style={styles.retryBtn}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : classworks.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="document-text-outline" size={40} color={AppColors.mutedForeground} />
                <Text style={styles.emptyText}>No classwork assigned yet.</Text>
              </View>
            ) : (
              classworks.map((cw) => (
                <ClassworkItem
                  key={cw.classwork_assignment_id}
                  title={cw.title}
                  submittedDate={cw.due_date
                    ? `Due ${new Date(cw.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                    : 'No due date'}
                  status={cw.submission_status ?? 'not_submitted_yet'}
                  onPress={() =>
                    router.push({
                      pathname: '/student/classwork-view' as any,
                      params: { assignment_id: cw.classwork_assignment_id },
                    })
                  }
                />
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    backgroundColor: AppColors.card,
    borderBottomWidth: Borders.width, borderBottomColor: AppColors.border,
  },
  subjectBanner: {
    marginTop: 12,
    marginHorizontal: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: BANNER_BG,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 10,
    padding: Spacing.md,
    gap: 12,
    marginBottom: 16,
    ...NeoShadow.md,
  },
  bannerTitle: { fontSize: 22, fontWeight: "900", color: AppColors.foreground },
  bannerSub: { fontSize: 13, color: AppColors.mutedForeground, marginTop: 6, lineHeight: 18 },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backText: { fontSize: 22, fontWeight: '700', color: AppColors.foreground },
  subjectCard: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 12,
    padding: Spacing.md,
    backgroundColor: '#F6E9B2',
    borderWidth: 2, borderColor: AppColors.border, borderRadius: 8,
    gap: 6,
    ...NeoShadow.lg,
  },
  subjectTitle: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  subjectTeacher: { fontSize: 13, color: AppColors.foreground },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: AppColors.muted, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  chipText: { fontSize: 11, fontWeight: '600', color: AppColors.mutedForeground },
  content: { padding: Spacing.md, paddingBottom: 32, gap: 12 },
  section: { gap: 12 },
  center: { alignItems: 'center', paddingTop: 48, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '600', color: AppColors.mutedForeground },
  errorText: { fontSize: 14, color: AppColors.destructive, textAlign: 'center' },
  hint: { fontSize: 14, color: AppColors.mutedForeground, textAlign: 'center', marginTop: 24 },
  retryBtn: {
    paddingHorizontal: 20, paddingVertical: 8,
    borderRadius: 8, borderWidth: Borders.width, borderColor: AppColors.border,
  },
  retryText: { fontSize: 14, fontWeight: '600', color: AppColors.foreground },
});
