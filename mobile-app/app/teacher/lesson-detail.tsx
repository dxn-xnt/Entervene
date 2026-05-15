import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/hooks/api';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';
import type { TeacherLesson } from '@/hooks/useTeacherData';

const BANNER_BG = '#F6E9B2';
const PUBLISHED_BG = '#dcfce7';
const PUBLISHED_BORDER = '#166534';

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

export default function LessonDetail() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{
    lesson_id?: string;
    subject_load_id?: string;
    class_id?: string;
    subject_id?: string;
    subject?: string;
    section?: string;
  }>();
  const [lesson, setLesson] = useState<TeacherLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);

  const fetchLesson = () => {
    if (!session?.token || !params.lesson_id) { setLoading(false); return; }
    apiFetch<TeacherLesson>(`/api/v1/lessons/${params.lesson_id}`, { token: session.token })
      .then(setLesson)
      .catch((e) => Alert.alert('Error', e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLesson(); }, [params.lesson_id, session?.token]);

  const handlePublish = async () => {
    if (!lesson) return;
    Alert.alert(
      'Publish Lesson',
      `Publish "${lesson.title}" now? Students will be able to see it immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          onPress: async () => {
            setPublishing(true);
            try {
              const updated = await apiFetch<TeacherLesson>(`/api/v1/lessons/${lesson.lesson_id}`, {
                method: 'PUT',
                token: session!.token,
                body: JSON.stringify({ is_published: true }),
              });
              setLesson(updated);
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to publish');
            } finally {
              setPublishing(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={AppColors.primary} />
          <Text style={s.loadingHint}>Loading lesson…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!lesson) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backRow} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
            <Text style={s.headerTitle}>Lesson</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.errorText}>Lesson not found</Text>
      </SafeAreaView>
    );
  }

  const updated = formatDate(lesson.updated_at);
  const created = formatDate(lesson.created_at);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>Lesson</Text>
        </TouchableOpacity>
        <View style={s.headerRight}>
          {/* Edit button */}
          <TouchableOpacity
            style={s.editBtn}
            activeOpacity={0.8}
            onPress={() => router.push({
              pathname: '/teacher/edit-lesson' as any,
              params: {
                lesson_id: lesson.lesson_id,
                subject_load_id: params.subject_load_id,
                class_id: params.class_id,
                subject_id: params.subject_id,
                subject: params.subject,
                section: params.section
              }
            })}
          >
            <Ionicons name="pencil-outline" size={14} color={AppColors.foreground} />
            <Text style={s.editBtnText}>Edit</Text>
          </TouchableOpacity>

          {/* Publish button — only for drafts */}
          {!lesson.is_published && (
            <TouchableOpacity
              style={[s.publishBtn, publishing && { opacity: 0.6 }]}
              activeOpacity={0.8}
              disabled={publishing}
              onPress={handlePublish}
            >
              {publishing ? (
                <ActivityIndicator size="small" color={AppColors.primaryForeground} />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={14} color={AppColors.primaryForeground} />
                  <Text style={s.publishBtnText}>Publish</Text>
                </>
              )}
            </TouchableOpacity>
          )}
          <View style={[s.statusPill, lesson.is_published ? s.statusPublished : s.statusDraft]}>
            <Ionicons
              name={lesson.is_published ? 'eye-outline' : 'eye-off-outline'}
              size={14}
              color={lesson.is_published ? PUBLISHED_BORDER : AppColors.foreground}
            />
            <Text style={[s.statusPillText, lesson.is_published ? s.statusPublishedText : s.statusDraftText]}>
              {lesson.is_published ? 'Published' : 'Draft'}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.hero}>
          <View style={s.heroTop}>
            <View style={s.orderChip}>
              <Text style={s.orderChipText}>#{lesson.order_index}</Text>
            </View>
            {lesson.subject_name ? (
              <View style={s.subjectChip}>
                <Ionicons name="book-outline" size={14} color={AppColors.foreground} />
                <Text style={s.subjectChipText} numberOfLines={1}>
                  {lesson.subject_name}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={s.heroTitle}>{lesson.title}</Text>
          {lesson.teacher_name ? (
            <View style={s.heroMetaRow}>
              <Ionicons name="person-outline" size={14} color={AppColors.mutedForeground} />
              <Text style={s.heroMeta}>{lesson.teacher_name}</Text>
            </View>
          ) : null}
          {(created || updated) && (
            <View style={s.dateRow}>
              {created ? (
                <Text style={s.dateText}>
                  <Text style={s.dateLabel}>Created </Text>
                  {created}
                </Text>
              ) : null}
              {updated && updated !== created ? (
                <Text style={s.dateText}>
                  <Text style={s.dateLabel}> · Updated </Text>
                  {updated}
                </Text>
              ) : null}
            </View>
          )}
        </View>

        {lesson.description ? (
          <View style={s.block}>
            <View style={s.blockHead}>
              <Ionicons name="text-outline" size={18} color={AppColors.foreground} />
              <Text style={s.blockTitle}>Description</Text>
            </View>
            <Text style={s.blockBody}>{lesson.description}</Text>
          </View>
        ) : null}

        {lesson.attachments?.length > 0 ? (
          <View style={s.block}>
            <View style={s.blockHead}>
              <Ionicons name="attach-outline" size={18} color={AppColors.foreground} />
              <Text style={s.blockTitle}>Attachments ({lesson.attachments.length})</Text>
            </View>
            <View style={s.attachList}>
              {lesson.attachments.map((a) => (
                <View key={a.lesson_attachment_id} style={s.attachRow}>
                  <View style={s.attachIcon}>
                    <Ionicons name="document-text-outline" size={22} color={AppColors.foreground} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.attachName} numberOfLines={2}>
                      {a.file_name}
                    </Text>
                    <Text style={s.attachSize}>
                      {typeof a.file_size === 'number'
                        ? `${(a.file_size / 1024).toFixed(0)} KB`
                        : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {!lesson.description && !lesson.content && !(lesson.attachments?.length) ? (
          <View style={s.emptyCard}>
            <Ionicons name="document-outline" size={40} color={AppColors.mutedForeground} />
            <Text style={s.emptyTitle}>No extra details</Text>
            <Text style={s.emptySub}>This lesson has no description, body text, or files yet.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  loadingHint: { fontSize: 14, color: AppColors.mutedForeground, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderBottomWidth: Borders.width,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  headerRight: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: AppColors.white, borderWidth: Borders.width,
    borderColor: AppColors.border, borderRadius: 8,
  },
  editBtnText: { fontSize: 12, fontWeight: '800', color: AppColors.foreground },
  publishBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: AppColors.primary, borderWidth: Borders.width,
    borderColor: AppColors.border, borderRadius: 8,
  },
  publishBtnText: { fontSize: 12, fontWeight: '800', color: AppColors.primaryForeground },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: AppColors.foreground },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: Borders.width,
    borderRadius: 999,
    ...NeoShadow.xs,
  },
  statusPublished: {
    backgroundColor: PUBLISHED_BG,
    borderColor: PUBLISHED_BORDER,
  },
  statusDraft: {
    backgroundColor: AppColors.muted,
    borderColor: AppColors.border,
  },
  statusPillText: { fontSize: 12, fontWeight: '800' },
  statusPublishedText: { color: PUBLISHED_BORDER },
  statusDraftText: { color: AppColors.foreground },
  scroll: { padding: Spacing.md, paddingBottom: 48, gap: Spacing.md },
  hero: {
    backgroundColor: BANNER_BG,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 10,
    padding: Spacing.md,
    ...NeoShadow.md,
  },
  heroTop: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  orderChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
    backgroundColor: AppColors.white,
    ...NeoShadow.xs,
  },
  orderChipText: { fontSize: 12, fontWeight: '900', color: AppColors.foreground },
  subjectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '70%',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
    backgroundColor: AppColors.white,
    ...NeoShadow.xs,
  },
  subjectChipText: { fontSize: 12, fontWeight: '700', color: AppColors.foreground, flexShrink: 1 },
  heroTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: AppColors.foreground,
    lineHeight: 30,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  heroMeta: { fontSize: 14, color: AppColors.mutedForeground, fontWeight: '600', flex: 1 },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  dateText: { fontSize: 12, color: AppColors.mutedForeground },
  dateLabel: { fontWeight: '700', color: AppColors.foreground },
  block: {
    backgroundColor: AppColors.white,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 10,
    padding: Spacing.md,
    ...NeoShadow.sm,
  },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    paddingBottom: 8,
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: AppColors.foreground,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  blockBody: { fontSize: 15, color: AppColors.foreground, lineHeight: 24 },
  attachList: { gap: 10 },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: AppColors.inputBackground,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 8,
  },
  attachIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: BANNER_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachName: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  attachSize: { fontSize: 12, color: AppColors.mutedForeground, marginTop: 2 },
  emptyCard: {
    alignItems: 'center',
    padding: Spacing.xl,
    borderWidth: Borders.width,
    borderStyle: 'dashed',
    borderColor: AppColors.border,
    borderRadius: 10,
    gap: 8,
    backgroundColor: AppColors.inputBackground,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: AppColors.foreground },
  emptySub: { fontSize: 13, color: AppColors.mutedForeground, textAlign: 'center', lineHeight: 20 },
  errorText: {
    fontSize: 14,
    color: AppColors.destructive,
    textAlign: 'center',
    marginTop: 32,
    fontWeight: '600',
  },
});
