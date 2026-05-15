import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StyleSheet, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDrawer } from '@/context/DrawerContext';
import { useTeacherLessons, TeacherLesson } from '@/hooks/useTeacherData';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/hooks/api';

type Tab = 'published' | 'drafts';

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

export default function TeacherLessons() {
  const { openDrawer } = useDrawer();
  const router = useRouter();
  const { session } = useAuth();
  const { lessons, isLoading, error, refresh } = useTeacherLessons();
  const [activeTab, setActiveTab] = useState<Tab>('published');
  const [publishingId, setPublishingId] = useState<number | null>(null);

  const published = lessons.filter((l) => l.is_published);
  const drafts    = lessons.filter((l) => !l.is_published);

  const handlePublishDraft = async (lesson: TeacherLesson) => {
    Alert.alert(
      'Publish Lesson',
      `Publish "${lesson.title}" now? Students will be able to see it immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          onPress: async () => {
            setPublishingId(lesson.lesson_id);
            try {
              await apiFetch(`/api/v1/lessons/${lesson.lesson_id}`, {
                method: 'PUT',
                token: session!.token,
                body: JSON.stringify({ is_published: true }),
              });
              refresh();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to publish lesson');
            } finally {
              setPublishingId(null);
            }
          },
        },
      ],
    );
  };

  const LessonCard = ({ lesson }: { lesson: TeacherLesson }) => (
    <TouchableOpacity
      style={[styles.card, !lesson.is_published && styles.draftCard]}
      activeOpacity={0.8}
      onPress={() =>
        router.push({ pathname: '/teacher/lesson-detail' as any, params: { lesson_id: lesson.lesson_id } })
      }
    >
      {/* Left accent strip for drafts */}
      {!lesson.is_published && <View style={styles.draftStrip} />}

      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{lesson.title}</Text>
          {lesson.attachments.length > 0 && (
            <View style={styles.attachBadge}>
              <Ionicons name="attach" size={12} color={AppColors.mutedForeground} />
              <Text style={styles.attachText}>{lesson.attachments.length}</Text>
            </View>
          )}
        </View>

        <Text style={styles.cardMeta}>
          {lesson.subject_name}
          {lesson.created_at ? `  ·  ${formatDate(lesson.created_at)}` : ''}
        </Text>

        {lesson.description ? (
          <Text style={styles.cardDesc} numberOfLines={2}>{lesson.description}</Text>
        ) : null}

        {/* Draft actions */}
        {!lesson.is_published && (
          <View style={styles.draftActions}>
            <TouchableOpacity
              style={styles.editDraftBtn}
              activeOpacity={0.8}
              onPress={() =>
                router.push({ pathname: '/teacher/lesson-detail' as any, params: { lesson_id: lesson.lesson_id } })
              }
            >
              <Ionicons name="pencil-outline" size={14} color={AppColors.foreground} />
              <Text style={styles.editDraftBtnText}>Edit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.publishDraftBtn, publishingId === lesson.lesson_id && { opacity: 0.6 }]}
              activeOpacity={0.8}
              disabled={publishingId === lesson.lesson_id}
              onPress={() => handlePublishDraft(lesson)}
            >
              {publishingId === lesson.lesson_id ? (
                <ActivityIndicator size="small" color={AppColors.primaryForeground} />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={14} color={AppColors.primaryForeground} />
                  <Text style={styles.publishDraftBtnText}>Publish Now</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {lesson.is_published && (
        <Ionicons name="chevron-forward" size={18} color={AppColors.mutedForeground} style={{ marginLeft: 4 }} />
      )}
    </TouchableOpacity>
  );

  const displayList = activeTab === 'published' ? published : drafts;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
            <Ionicons name="menu" size={24} color={AppColors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>Lessons</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/teacher/create-lesson' as any)}
          style={styles.addButton}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={16} color={AppColors.primaryForeground} />
          <Text style={styles.addButtonText}>New Lesson</Text>
        </TouchableOpacity>
      </View>

      {/* ── Tabs ── */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'published' && styles.tabActive]}
          activeOpacity={0.8}
          onPress={() => setActiveTab('published')}
        >
          <Ionicons
            name="eye-outline"
            size={15}
            color={activeTab === 'published' ? AppColors.primaryForeground : AppColors.mutedForeground}
          />
          <Text style={[styles.tabText, activeTab === 'published' && styles.tabTextActive]}>
            Published
          </Text>
          {published.length > 0 && (
            <View style={[styles.tabBadge, activeTab === 'published' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === 'published' && styles.tabBadgeTextActive]}>
                {published.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'drafts' && styles.tabActive]}
          activeOpacity={0.8}
          onPress={() => setActiveTab('drafts')}
        >
          <Ionicons
            name="save-outline"
            size={15}
            color={activeTab === 'drafts' ? AppColors.primaryForeground : AppColors.mutedForeground}
          />
          <Text style={[styles.tabText, activeTab === 'drafts' && styles.tabTextActive]}>
            Drafts
          </Text>
          {drafts.length > 0 && (
            <View style={[styles.tabBadge, activeTab === 'drafts' && styles.tabBadgeActive, styles.draftTabBadge]}>
              <Text style={[styles.tabBadgeText, activeTab === 'drafts' && styles.tabBadgeTextActive]}>
                {drafts.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Draft hint banner ── */}
      {activeTab === 'drafts' && drafts.length > 0 && (
        <View style={styles.draftBanner}>
          <Ionicons name="information-circle-outline" size={16} color="#92400e" />
          <Text style={styles.draftBannerText}>
            Drafts are only visible to you. Tap <Text style={{ fontWeight: '800' }}>Publish Now</Text> to make a lesson visible to students.
          </Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} />}
      >
        {isLoading && lessons.length === 0 ? (
          <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 32 }} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : displayList.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons
              name={activeTab === 'published' ? 'document-text-outline' : 'save-outline'}
              size={48}
              color={AppColors.muted}
            />
            <Text style={styles.emptyText}>
              {activeTab === 'published' ? 'No published lessons' : 'No draft lessons'}
            </Text>
            <Text style={styles.emptySubtext}>
              {activeTab === 'published'
                ? 'Create a lesson and publish it to show it to students.'
                : 'Save a lesson as a draft to continue editing later.'}
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              activeOpacity={0.8}
              onPress={() => router.push('/teacher/create-lesson' as any)}
            >
              <Ionicons name="add" size={16} color={AppColors.primaryForeground} />
              <Text style={styles.emptyButtonText}>Create Lesson</Text>
            </TouchableOpacity>
          </View>
        ) : (
          displayList.map((l) => <LessonCard key={l.lesson_id} lesson={l} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: 14,
    borderBottomWidth: Borders.width, borderBottomColor: AppColors.border,
  },
  title: { fontSize: 18, fontWeight: '800', color: AppColors.foreground },
  addButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 7, paddingHorizontal: 12,
    backgroundColor: AppColors.primary, borderWidth: Borders.width,
    borderColor: AppColors.border, borderRadius: 8, ...NeoShadow.sm,
  },
  addButtonText: { fontSize: 13, fontWeight: '700', color: AppColors.primaryForeground },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: Borders.width,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: AppColors.primary,
    backgroundColor: AppColors.inputBackground,
  },
  tabText: { fontSize: 13, fontWeight: '700', color: AppColors.mutedForeground },
  tabTextActive: { color: AppColors.primary },
  tabBadge: {
    paddingHorizontal: 6, paddingVertical: 1,
    backgroundColor: AppColors.muted, borderRadius: 999,
    borderWidth: Borders.width, borderColor: AppColors.border,
  },
  tabBadgeActive: { backgroundColor: AppColors.primary, borderColor: AppColors.border },
  draftTabBadge: { backgroundColor: '#fef3c7', borderColor: '#f59e0b' },
  tabBadgeText: { fontSize: 10, fontWeight: '800', color: AppColors.mutedForeground },
  tabBadgeTextActive: { color: AppColors.primaryForeground },

  // Draft banner
  draftBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
    backgroundColor: '#fef3c7', borderBottomWidth: Borders.width, borderBottomColor: '#f59e0b',
  },
  draftBannerText: { flex: 1, fontSize: 12, color: '#92400e', lineHeight: 18 },

  // Content
  content: { padding: Spacing.lg, gap: 12, paddingBottom: 40 },
  errorText: { fontSize: 14, color: AppColors.destructive, textAlign: 'center', marginTop: 24 },
  emptyState: { alignItems: 'center', marginTop: 48, gap: 10 },
  emptyText: { fontSize: 18, fontWeight: '800', color: AppColors.foreground },
  emptySubtext: { fontSize: 13, color: AppColors.mutedForeground, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
  emptyButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8,
    paddingVertical: 10, paddingHorizontal: 20,
    backgroundColor: AppColors.primary, borderWidth: Borders.width,
    borderColor: AppColors.border, borderRadius: 8, ...NeoShadow.sm,
  },
  emptyButtonText: { fontSize: 14, fontWeight: '700', color: AppColors.primaryForeground },

  // Lesson card
  card: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: Borders.width, borderColor: AppColors.border,
    backgroundColor: AppColors.card, borderRadius: 10,
    overflow: 'hidden', ...NeoShadow.sm,
  },
  draftCard: {
    backgroundColor: '#fffbeb', borderColor: '#f59e0b',
  },
  draftStrip: {
    width: 4, alignSelf: 'stretch',
    backgroundColor: '#f59e0b',
  },
  cardBody: { flex: 1, padding: 14, gap: 4 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: AppColors.foreground },
  cardMeta: { fontSize: 12, fontWeight: '600', color: AppColors.mutedForeground },
  cardDesc: { fontSize: 13, color: AppColors.mutedForeground, marginTop: 2 },
  attachBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  attachText: { fontSize: 12, color: AppColors.mutedForeground },

  // Draft card action buttons
  draftActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  editDraftBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 12,
    borderWidth: Borders.width, borderColor: AppColors.border,
    borderRadius: 6, backgroundColor: AppColors.white,
  },
  editDraftBtnText: { fontSize: 12, fontWeight: '700', color: AppColors.foreground },
  publishDraftBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 12,
    borderWidth: Borders.width, borderColor: AppColors.border,
    borderRadius: 6, backgroundColor: AppColors.primary,
    ...NeoShadow.xs,
  },
  publishDraftBtnText: { fontSize: 12, fontWeight: '700', color: AppColors.primaryForeground },
});
