import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, Linking, Alert,
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

type LessonAttachment = {
  lesson_attachment_id: number;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
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

type LessonDetail = {
  lesson_id: number;
  title: string;
  description: string | null;
  content: string | null;
  attachments: LessonAttachment[];
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

  const [lessonDetail, setLessonDetail] = useState<LessonDetail | null>(null);
  const [classworks, setClassworks] = useState<LessonClasswork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!session?.token || !lessonId || !classId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch lesson details (including attachments)
      const lesson = await apiFetch<LessonDetail>(
        `/api/v1/lessons/${lessonId}`,
        { token: session.token },
      );
      setLessonDetail(lesson);

      // Fetch classwork assignments
      const classworkData = await apiFetch<LessonClasswork[]>(
        `/api/v1/lessons/${lessonId}/classwork-assignments?class_id=${classId}`,
        { token: session.token },
      );
      setClassworks(classworkData ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session?.token, lessonId, classId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getFileIcon = (fileType: string): React.ReactNode => {
    if (fileType.includes('pdf')) return <Ionicons name="document" size={16} color={AppColors.destructive} />;
    if (fileType.includes('word') || fileType.includes('document')) return <Ionicons name="document-text" size={16} color={AppColors.primary} />;
    if (fileType.includes('sheet') || fileType.includes('excel')) return <Ionicons name="grid" size={16} color={AppColors.primary} />;
    if (fileType.includes('image')) return <Ionicons name="image" size={16} color={AppColors.primary} />;
    return <Ionicons name="document-outline" size={16} color={AppColors.mutedForeground} />;
  };

  const handleDownloadAttachment = (attachmentId: number, fileName: string) => {
    if (!lessonId) return;

    const downloadUrl = `${process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000'}/api/v1/lessons/${lessonId}/attachments/${attachmentId}/download`;

    Alert.alert(
      'Download File',
      `Opening: ${fileName}`,
      [
        { text: 'Cancel', onPress: () => { } },
        { text: 'Open', onPress: () => Linking.openURL(downloadUrl) },
      ]
    );
  };

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
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchData} />}
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

        {/* ── Lesson Attachments ── */}
        {lessonDetail && lessonDetail.attachments && lessonDetail.attachments.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Attachments</Text>
            <View style={styles.attachmentsList}>
              {lessonDetail.attachments.map((att) => (
                <TouchableOpacity
                  key={att.lesson_attachment_id}
                  style={styles.attachmentCard}
                  onPress={() => handleDownloadAttachment(att.lesson_attachment_id, att.file_name)}
                  activeOpacity={0.7}
                >
                  <View style={styles.attachmentIcon}>
                    {getFileIcon(att.file_type)}
                  </View>
                  <View style={styles.attachmentInfo}>
                    <Text style={styles.attachmentName} numberOfLines={2}>{att.file_name}</Text>
                    <Text style={styles.attachmentSize}>{formatFileSize(att.file_size)}</Text>
                  </View>
                  <Ionicons name="download-outline" size={20} color={AppColors.primary} />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

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
                status={cw.submission_status ?? 'not_submitted_yet'}
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
  attachmentsList: {
    gap: 8,
  },
  attachmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppColors.card,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 8,
    padding: Spacing.md,
    gap: 12,
    ...NeoShadow.sm,
  },
  attachmentIcon: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: AppColors.muted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentInfo: {
    flex: 1,
    gap: 2,
  },
  attachmentName: {
    fontSize: 13,
    fontWeight: '600',
    color: AppColors.foreground,
  },
  attachmentSize: {
    fontSize: 12,
    color: AppColors.mutedForeground,
  },
  cwList: { gap: 10 },
  emptyBox: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyText: { fontSize: 14, color: AppColors.mutedForeground },
  errorText: { fontSize: 13, color: AppColors.destructive },
});

export default LessonView;
