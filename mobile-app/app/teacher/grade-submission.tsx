import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/hooks/api';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';
import { Submission } from '@/hooks/useSubmissions';
import { API_BASE_URL } from '@/constants/api';

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(type: string | null): keyof typeof Ionicons.glyphMap {
  if (!type) return 'document-outline';
  if (type.startsWith('image/')) return 'image-outline';
  if (type === 'application/pdf') return 'document-text-outline';
  if (type.includes('word')) return 'document-outline';
  if (type.includes('sheet') || type.includes('excel')) return 'grid-outline';
  if (type.includes('zip') || type.includes('rar')) return 'archive-outline';
  return 'attach-outline';
}

export default function GradeSubmission() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{
    submission_id?: string;
    student_name?: string;
    classwork_title?: string;
    total_points?: string;
  }>();

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [grade, setGrade] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch full submission detail so teacher can see the submitted files
  useEffect(() => {
    if (!session?.token || !params.submission_id) {
      setLoadingDetail(false);
      return;
    }
    const go = async () => {
      try {
        const data = await apiFetch<Submission>(
          `/api/v1/submissions/${params.submission_id}/detail`,
          { token: session.token },
        );
        setSubmission(data);
        // Pre-fill grade/feedback if already graded
        if (data.grade !== null) setGrade(String(data.grade));
        if (data.feedback) setFeedback(data.feedback);
      } catch (e: any) {
        Alert.alert('Error', e.message || 'Could not load submission details');
      } finally {
        setLoadingDetail(false);
      }
    };
    void go();
  }, [params.submission_id, session?.token]);

  const handleOpenFile = async (attachmentId: number) => {
    const url = `${API_BASE_URL}/api/v1/submissions/${params.submission_id}/attachments/${attachmentId}/download`;
    const tokenParam = session?.token ? `?token=${encodeURIComponent(session.token)}` : '';
    try {
      await WebBrowser.openBrowserAsync(`${url}${tokenParam}`);
    } catch (e: any) {
      Alert.alert('Cannot open', e.message || 'Unable to open this file on your device.');
    }
  };

  const handleGrade = async () => {
    if (!grade.trim()) {
      Alert.alert('Error', 'Enter a grade');
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/v1/submissions/${params.submission_id}/grade`, {
        method: 'PUT',
        token: session!.token,
        body: JSON.stringify({ grade: parseFloat(grade), feedback }),
      });
      Alert.alert('Success', 'Grade submitted!');
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loadingDetail) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
            <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
            <Text style={s.headerTitle}>Grade Submission</Text>
          </TouchableOpacity>
        </View>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={AppColors.primary} />
          <Text style={s.loadingText}>Loading submission…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const attachments = submission?.attachments ?? [];
  const totalPoints = params.total_points || '100';
  const isAlreadyGraded = submission?.status === 'graded';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>Grade Submission</Text>
        </TouchableOpacity>
        {isAlreadyGraded && (
          <View style={s.gradedBadge}>
            <Ionicons name="checkmark-circle" size={14} color="#166534" />
            <Text style={s.gradedBadgeText}>Graded</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        {/* Student / Classwork info */}
        <View style={s.infoCard}>
          <View style={s.infoRow}>
            <Ionicons name="person-outline" size={16} color={AppColors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={s.infoLabel}>Student</Text>
              <Text style={s.infoValue}>{params.student_name || submission?.student_name || 'Unknown'}</Text>
            </View>
          </View>
          {submission && (
            <>
              <View style={s.metaRow}>
                <View style={s.metaChip}>
                  <Ionicons name="time-outline" size={12} color={AppColors.mutedForeground} />
                  <Text style={s.metaChipText}>
                    {submission.submitted_at
                      ? new Date(submission.submitted_at).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })
                      : 'No date'}
                  </Text>
                </View>
                <View style={s.metaChip}>
                  <Ionicons name="refresh-outline" size={12} color={AppColors.mutedForeground} />
                  <Text style={s.metaChipText}>Attempt {submission.attempt_count}</Text>
                </View>
              </View>
            </>
          )}
        </View>

        {/* Submitted Files */}
        <View style={s.section}>
          <View style={s.infoRow}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={s.heroIconWrap}>
                <Ionicons name={'code-slash-outline'} size={20} color={AppColors.foreground} />
              </View>
              <Text style={s.infoValue}>{params.classwork_title || submission?.classwork_title || '—'}</Text>
            </View>
          </View>

          <View style={s.sectionHeader}>
            <Ionicons name="attach-outline" size={18} color={AppColors.foreground} />
            <Text style={s.sectionTitle}>Submitted Files</Text>
          </View>

          {attachments.length === 0 ? (
            <View style={s.emptyFiles}>
              <Ionicons name="folder-open-outline" size={32} color={AppColors.muted} />
              <Text style={s.emptyFilesText}>No files attached</Text>
            </View>
          ) : (
            attachments.map((att) => (
              <TouchableOpacity
                key={att.submission_attachment_id}
                style={s.fileRow}
                activeOpacity={0.75}
                onPress={() => handleOpenFile(att.submission_attachment_id)}
              >
                <View style={s.fileIcon}>
                  <Ionicons name={fileIcon(att.file_type)} size={22} color={AppColors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fileName} numberOfLines={2}>{att.file_name}</Text>
                  {att.file_size ? (
                    <Text style={s.fileSize}>{formatBytes(att.file_size)}</Text>
                  ) : null}
                </View>
                <Ionicons name="open-outline" size={18} color={AppColors.mutedForeground} />
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Grading Form */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="ribbon-outline" size={18} color={AppColors.foreground} />
            <Text style={s.sectionTitle}>
              {isAlreadyGraded ? 'Update Grade' : 'Grade'}
            </Text>
          </View>

          <View style={s.field}>
            <Text style={s.label}>Grade (out of {totalPoints})</Text>
            <TextInput
              style={s.input}
              value={grade}
              onChangeText={setGrade}
              keyboardType="numeric"
              placeholder={`e.g. ${totalPoints}`}
              placeholderTextColor={AppColors.placeholder}
            />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Feedback <Text style={s.optional}>(optional)</Text></Text>
            <TextInput
              style={[s.input, s.textArea]}
              value={feedback}
              onChangeText={setFeedback}
              placeholder="Write feedback for the student..."
              multiline
              numberOfLines={4}
              placeholderTextColor={AppColors.placeholder}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[s.saveButton, saving && { opacity: 0.7 }]}
          onPress={handleGrade}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={AppColors.primaryForeground} />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={20} color={AppColors.primaryForeground} />
              <Text style={s.saveButtonText}>
                {isAlreadyGraded ? 'Update Grade' : 'Submit Grade'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  heroIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
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
  headerTitle: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  gradedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#dcfce7',
    borderWidth: Borders.width,
    borderColor: '#166534',
    borderRadius: 999,
  },
  gradedBadgeText: { fontSize: 11, fontWeight: '800', color: '#166534' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: AppColors.mutedForeground, fontWeight: '600' },
  form: { padding: Spacing.lg, gap: 20, paddingBottom: 48 },
  infoCard: {
    padding: 16,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    borderRadius: 10,
    gap: 12,
    ...NeoShadow.sm,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoLabel: { fontSize: 11, fontWeight: '600', color: AppColors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: 20, fontWeight: '600', color: AppColors.foreground, marginTop: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: AppColors.inputBackground,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
  },
  metaChipText: { fontSize: 11, fontWeight: '600', color: AppColors.foreground },
  statusChip: { backgroundColor: AppColors.primary },
  statusText: { fontSize: 11, fontWeight: '800', color: AppColors.primaryForeground },
  section: {
    backgroundColor: AppColors.white,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 10,
    padding: Spacing.md,
    gap: 12,
    ...NeoShadow.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: AppColors.foreground,
    letterSpacing: 0.6,
    flex: 1,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: AppColors.primary,
    borderRadius: 999,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
  },
  countBadgeText: { fontSize: 11, fontWeight: '900', color: AppColors.primaryForeground },
  emptyFiles: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyFilesText: { fontSize: 13, color: AppColors.mutedForeground, fontWeight: '600' },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: AppColors.inputBackground,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 8,
  },
  fileIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileName: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  fileSize: { fontSize: 12, color: AppColors.mutedForeground, marginTop: 2 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  optional: { fontSize: 12, fontWeight: '400', color: AppColors.mutedForeground },
  input: {
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: AppColors.foreground,
    backgroundColor: AppColors.white,
    borderRadius: 8,
    ...NeoShadow.xs,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    paddingVertical: 16,
    borderRadius: 10,
    ...NeoShadow.md,
  },
  saveButtonText: { fontSize: 16, fontWeight: '900', color: AppColors.primaryForeground },
});
