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
import FileViewer from '@/components/teacher/file-viewer';
import SubmissionMonitor from '@/components/teacher/submission-monitor';
import { useClassworkSubmissionTracking } from '@/hooks/useSubmissions';

const BANNER_BG = '#F6E9B2';
const POINTS_BG = '#fef08a';
const PUBLISHED_BG = '#dcfce7';
const LOCKED_BG = '#fecaca';

type ClassworkDetailData = {
  classwork_id: number;
  title: string;
  description: string | null;
  instructions: string | null;
  classwork_type: string;
  classwork_category: string | null;
  total_points: number | null;
  is_published: boolean;
  is_locked: boolean;
  subject_id: number;
  subject_name: string | null;
  teacher_name: string | null;
  due_date?: string | null;
  attachments: {
    classwork_attachment_id: number;
    file_name: string;
    file_size?: number;
  }[];
  created_at?: string | null;
  updated_at?: string | null;
};


function cwTypeIcon(t: string): keyof typeof Ionicons.glyphMap {
  const u = (t || '').toUpperCase();
  if (u.includes('QUIZ') || u.includes('EXAM')) return 'help-circle-outline';
  if (u.includes('ACTIVITY')) return 'code-slash-outline';
  if (u.includes('ASSIGNMENT')) return 'laptop-outline';
  return 'document-text-outline';
}

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

export default function ClassworkDetail() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ classwork_id?: string; due_date?: string }>();
  const [cw, setCw] = useState<ClassworkDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const classworkId = params.classwork_id ? Number(params.classwork_id) : null;

  const { tracking, isLoading: submissionsLoading, error: submissionError } = useClassworkSubmissionTracking(classworkId || 0);

  useEffect(() => {
    if (!session?.token || !params.classwork_id) {
      setLoading(false);
      return;
    }
    const go = async () => {
      try {
        const data = await apiFetch<ClassworkDetailData>(
          `/api/v1/classwork-assignments/classwork/${params.classwork_id}`,
          { token: session.token },
        );
        setCw(data);
      } catch (e: any) {
        Alert.alert('Error', e.message);
      } finally {
        setLoading(false);
      }
    };
    void go();
  }, [params.classwork_id, session?.token]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={AppColors.primary} />
          <Text style={s.loadingHint}>Loading classwork…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!cw) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backRow} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
            <Text style={s.headerTitle}>Classwork</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.errorText}>Not found</Text>
      </SafeAreaView>
    );
  }

  const paramDueDate = Array.isArray(params.due_date) ? params.due_date[0] : params.due_date;
  const dueDate = cw?.due_date || paramDueDate || null;
  const isPastDue = dueDate ? new Date() > new Date(dueDate) : false;
  const missingList = isPastDue ? (tracking?.missing ?? []) : [];

  const pts = cw.total_points != null ? `${cw.total_points} pts` : '—';
  const updated = formatDate(cw.updated_at);
  const created = formatDate(cw.created_at);
  const dueDateFormatted = formatDate(dueDate);
  const atts = cw.attachments ?? [];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>Classwork</Text>
        </TouchableOpacity>
        <View style={s.headerBadges}>
          {cw.is_locked ? (
            <View style={[s.miniPill, s.miniPillLocked]}>
              <Ionicons name="lock-closed-outline" size={12} color="#991b1b" />
              <Text style={s.miniPillLockedText}>Locked</Text>
            </View>
          ) : null}
          <View style={[s.miniPill, cw.is_published ? s.miniPillLive : s.miniPillDraft]}>
            <Text style={s.miniPillText}>{cw.is_published ? 'Published' : 'Draft'}</Text>
          </View>
          <TouchableOpacity
            style={s.editButton}
            onPress={() =>
              router.push({
                pathname: '/teacher/edit-classwork' as any,
                params: { classwork_id: cw.classwork_id },
              })
            }
            hitSlop={10}
          >
            <Ionicons name="pencil-outline" size={16} color={AppColors.primaryForeground} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Hero card ── */}
        <View style={s.hero}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <View style={s.heroIconWrap}>
              <Ionicons name={cwTypeIcon(cw.classwork_type)} size={20} color={AppColors.foreground} />
            </View>
            <Text style={[s.heroTitle, { marginBottom: 8 }]}>{cw.title}</Text>
          </View>

          <View style={s.typeRow}>
            <View style={s.typeBadge}>
              <Text style={s.typeBadgeText}>{cw.classwork_type}</Text>
            </View>
            {cw.classwork_category ? (
              <View style={s.catBadge}>
                <Text style={s.catBadgeText} numberOfLines={1}>
                  {cw.classwork_category.replace(/_/g, ' ')}
                </Text>
              </View>
            ) : null}
            <View style={s.pointsBadge}>
              <Text style={s.pointsBadgeText}>{pts}</Text>
            </View>
          </View>
          <View style={s.metaRow}>
            {cw.subject_name ? (
              <View style={s.metaChip}>
                <Ionicons name="book-outline" size={14} color={AppColors.foreground} />
                <Text style={s.metaChipText} numberOfLines={1}>
                  {cw.subject_name}
                </Text>
              </View>
            ) : null}
          </View>

          {/* ── Due date chip ── */}
          <View style={[s.dueChip, dueDate ? s.dueChipSet : s.dueChipNone]}>
            <Ionicons
              name="time-outline"
              size={14}
              color={dueDate ? '#166534' : AppColors.mutedForeground}
            />
            <Text style={[s.dueChipText, dueDate ? s.dueChipTextSet : s.dueChipTextNone]}>
              {dueDate ? `Due ${dueDateFormatted}` : 'No due date'}
            </Text>
          </View>

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

        {/* ── Description ──
        {cw.description ? (
          <View style={s.block}>
            <View style={s.blockHead}>
              <Ionicons name="text-outline" size={18} color={AppColors.foreground} />
              <Text style={s.blockTitle}>Description</Text>
            </View>
            <Text style={s.blockBody}>{cw.description}</Text>
          </View>
        ) : null} */}

        {/* ── Instructions ── */}
        {cw.instructions ? (
          <View style={s.block}>
            <View style={s.blockHead}>
              <Ionicons name="list-outline" size={18} color={AppColors.foreground} />
              <Text style={s.blockTitle}>Instructions</Text>
            </View>
            <Text style={s.blockBody}>{cw.instructions}</Text>
          </View>
        ) : null}

        {/* ── Attachments ── */}
        {atts.length > 0 ? (
          <View style={s.block}>
            <View style={s.blockHead}>
              <Ionicons name="attach-outline" size={18} color={AppColors.foreground} />
              <Text style={s.blockTitle}>Attachments ({atts.length})</Text>
            </View>
            <FileViewer
              files={atts.map((a) => ({
                file_name: a.file_name,
                file_size: a.file_size,
                classwork_attachment_id: a.classwork_attachment_id,
              }))}
              canDownload={true}
              canView={true}
              token={session?.token}
              classworkId={cw.classwork_id}
            />
          </View>
        ) : null}

        {/* ── Student Submissions ── */}
        <View style={s.block}>
          <View style={s.blockHead}>
            <Ionicons name="people-outline" size={18} color={AppColors.foreground} />
            <Text style={s.blockTitle}>Student Submissions</Text>
            {tracking && !submissionsLoading && (
              <View style={s.submissionPill}>
                <Text style={s.submissionPillText}>
                  {tracking.submitted_count}/{tracking.total_students}
                </Text>
              </View>
            )}
          </View>
          {submissionError ? (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle-outline" size={20} color={AppColors.destructive} />
              <Text style={s.errorBoxText}>Error: {submissionError}</Text>
            </View>
          ) : (
            <SubmissionMonitor
              submitted={tracking?.submitted ?? []}
              missing={missingList}
              isLoading={submissionsLoading}
              classworkTitle={cw.title}
              totalPoints={cw.total_points ?? 100}
              dueDate={dueDate}
            />
          )}
        </View>

        {/* ── Empty state ── */}
        {!cw.description && !cw.instructions && atts.length === 0 ? (
          <View style={s.emptyCard}>
            <Ionicons name="clipboard-outline" size={40} color={AppColors.mutedForeground} />
            <Text style={s.emptyTitle}>No details yet</Text>
            <Text style={s.emptySub}>
              Add a description, instructions, or files when editing this classwork.
            </Text>
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
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: AppColors.foreground },
  headerBadges: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  miniPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: Borders.width,
    borderRadius: 999,
    ...NeoShadow.xs,
  },
  miniPillLive:   { backgroundColor: PUBLISHED_BG, borderColor: '#166534' },
  miniPillDraft:  { backgroundColor: AppColors.muted, borderColor: AppColors.border },
  miniPillLocked: { backgroundColor: LOCKED_BG, borderColor: '#991b1b' },
  miniPillText:       { fontSize: 11, fontWeight: '800', color: AppColors.foreground },
  miniPillLockedText: { fontSize: 11, fontWeight: '800', color: '#991b1b' },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: AppColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...NeoShadow.xs,
  },
  scroll: { padding: Spacing.md, paddingBottom: 48, gap: Spacing.md },
  hero: {
    backgroundColor: BANNER_BG,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 10,
    padding: Spacing.md,
    ...NeoShadow.md,
  },
  heroIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    ...NeoShadow.sm,
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
  },
  typeBadgeText: { fontSize: 12, fontWeight: '900', color: AppColors.primaryForeground },
  catBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
  },
  catBadgeText: { fontSize: 11, fontWeight: '800', color: AppColors.foreground, textTransform: 'capitalize' },
  pointsBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
  },
  pointsBadgeText: { fontSize: 12, fontWeight: '900', color: AppColors.foreground },
  heroTitle: { fontSize: 24, fontWeight: '700', color: AppColors.foreground, lineHeight: 28 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: AppColors.white,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
  },
  metaChipText: { fontSize: 12, fontWeight: '700', color: AppColors.foreground, flexShrink: 1 },
  metaPerson: { fontSize: 13, fontWeight: '600', color: AppColors.mutedForeground, flex: 1 },
  dueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: Borders.width,
    borderRadius: 6,
  },
  dueChipSet:  { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  dueChipNone: { backgroundColor: AppColors.inputBackground, borderColor: AppColors.border },
  dueChipText: { fontSize: 12, fontWeight: '700' },
  dueChipTextSet:  { color: '#166534' },
  dueChipTextNone: { color: AppColors.mutedForeground },
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
    fontSize: 15,
    fontWeight: '600',
    color: AppColors.foreground,
    letterSpacing: 0.6,
    flex: 1,
  },
  blockBody: { fontSize: 15, color: AppColors.foreground, lineHeight: 24, },
  submissionPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: AppColors.primary,
    borderRadius: 999,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
  },
  submissionPillText: { fontSize: 11, fontWeight: '900', color: AppColors.primaryForeground },
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
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: '#FEE2E2',
    borderWidth: Borders.width,
    borderColor: AppColors.destructive,
    borderRadius: 8,
  },
  errorBoxText: {
    fontSize: 14,
    color: AppColors.destructive,
    fontWeight: '600',
    flex: 1,
  },
});