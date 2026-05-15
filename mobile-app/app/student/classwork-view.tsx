import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, apiUpload } from '@/hooks/api';
import { API_BASE_URL } from '@/constants/api';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

const statusColors: Record<string, string> = { pending: '#f59e0b', submitted: '#3b82f6', graded: '#22c55e', late: '#ef4444' };

export default function ClassworkView() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ assignment_id?: string }>();
  const [data, setData] = useState<any>(null);
  const [submission, setSubmission] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<{ uri: string; name: string; type: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [unsubmitting, setUnsubmitting] = useState(false);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<number | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelRequestedRef = useRef(false);

  const fetchData = async () => {
    if (!session?.token || !params.assignment_id) return;
    try {
      const [cwData, mySubs] = await Promise.all([
        apiFetch(`/api/v1/classwork-assignments/assignment/${params.assignment_id}`, { token: session.token }),
        apiFetch('/api/v1/submissions/my-submissions', { token: session.token }),
      ]);
      setData(cwData);
      const match = (mySubs as any[]).find((s) => s.classwork_assignment_id === parseInt(params.assignment_id!));
      if (match) setSubmission(match);
    } catch (e: any) { Alert.alert('Error', e.message); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [params.assignment_id, session?.token]);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'image/jpeg', 'image/png'],
      multiple: true,
    });
    if (!result.canceled && result.assets) setFiles((p) => [...p, ...result.assets.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType || 'application/octet-stream' }))]);
  };

  const hasSavedDraftFiles =
    submission?.status === 'pending' && (submission.attachments?.length ?? 0) > 0;

  const handleSubmit = async () => {
    if (files.length === 0 && !hasSavedDraftFiles) {
      Alert.alert('Error', 'Pick at least one file');
      return;
    }
    setSubmitting(true);
    setCancelRequested(false);
    cancelRequestedRef.current = false;
    try {
      const result =
        files.length > 0
          ? await apiUpload(
              `/api/v1/submissions/assignment/${params.assignment_id}/submit`,
              files,
              session!.token,
            )
          : await apiFetch(
              `/api/v1/submissions/assignment/${params.assignment_id}/submit`,
              { method: 'POST', token: session!.token },
            );
      if (cancelRequestedRef.current) {
        const draft = await apiFetch(
          `/api/v1/submissions/assignment/${params.assignment_id}/unsubmit`,
          { method: 'POST', token: session!.token },
        );
        setSubmission(draft);
        Alert.alert('Submission cancelled', 'Your uploaded files were kept as a draft.');
        return;
      }
      setSubmission(result);
      setFiles([]);
      Alert.alert('Success', 'Assignment submitted!');
    } catch (e: any) {
      if (cancelRequestedRef.current) {
        Alert.alert('Submission cancelled', 'Your selected files were kept.');
        return;
      }
      Alert.alert('Error', e.message);
    } finally {
      setCancelRequested(false);
      cancelRequestedRef.current = false;
      setSubmitting(false);
    }
  };

  const handleCancelSubmit = () => {
    setCancelRequested(true);
    cancelRequestedRef.current = true;
  };

  const handleUnsubmit = () => {
    setUnsubmitting(true);
    apiFetch(
      `/api/v1/submissions/assignment/${params.assignment_id}/unsubmit`,
      { method: 'POST', token: session!.token },
    )
      .then((result) => {
        setSubmission(result);
        setFiles([]);
      })
      .catch((e: any) => { Alert.alert('Error', e.message); })
      .finally(() => {
        setUnsubmitting(false);
      });
  };

  const handleRemoveSavedAttachment = async (attachmentId: number) => {
    if (!params.assignment_id || submission?.status !== 'pending') return;
    setRemovingAttachmentId(attachmentId);
    try {
      const result = await apiFetch(
        `/api/v1/submissions/assignment/${params.assignment_id}/attachments/${attachmentId}`,
        { method: 'DELETE', token: session!.token },
      );
      setSubmission(result);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setRemovingAttachmentId(null);
    }
  };

  const openClassworkAttachment = async (classworkId: number, attachmentId: number) => {
    const url = `${API_BASE_URL}/api/v1/classwork-assignments/classwork/${classworkId}/attachments/${attachmentId}/download`;
    const tokenParam = session?.token ? `?token=${encodeURIComponent(session.token)}` : '';
    try { await WebBrowser.openBrowserAsync(`${url}${tokenParam}`); }
    catch (e: any) { Alert.alert('Error', e.message || 'Cannot open file'); }
  };

  const openSubmissionAttachment = async (submissionId: number, attachmentId: number) => {
    const url = `${API_BASE_URL}/api/v1/submissions/${submissionId}/attachments/${attachmentId}/download`;
    const tokenParam = session?.token ? `?token=${encodeURIComponent(session.token)}` : '';
    try { await WebBrowser.openBrowserAsync(`${url}${tokenParam}`); }
    catch (e: any) { Alert.alert('Error', e.message || 'Cannot open file'); }
  };

  if (loading) return <SafeAreaView style={s.safe}><ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 60 }} /></SafeAreaView>;
  if (!data) return <SafeAreaView style={s.safe}><Text style={s.errorText}>Not found</Text></SafeAreaView>;

  const isGraded = submission?.status === 'graded';
  const isSubmitted = submission?.status === 'submitted' || submission?.status === 'late';
  const isDraft = !isGraded && (!submission || submission.status === 'pending');
  const isPastDue = Boolean(data.due_date && new Date() > new Date(data.due_date));
  const canUnsubmit = isSubmitted && !data.is_locked && !isPastDue;
  const canSubmitDraft = isDraft && !data.is_locked && !isPastDue;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>Classwork</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.typeBadge}><Text style={s.typeBadgeText}>{data.classwork_type}</Text></View>
        <Text style={s.title}>{data.title}</Text>
        <Text style={s.meta}>{data.teacher_name} · {data.total_points} pts</Text>
        {data.due_date && <View style={s.dueRow}><Ionicons name="time-outline" size={16} color={AppColors.destructive} /><Text style={s.dueText}>Due: {new Date(data.due_date).toLocaleString()}</Text></View>}
        {data.instructions && <View style={s.section}><Text style={s.sectionLabel}>Instructions</Text><Text style={s.bodyText}>{data.instructions}</Text></View>}
        {data.attachments?.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Reference Files</Text>
            {data.attachments.map((a: any) => (
              <TouchableOpacity
                key={a.classwork_attachment_id}
                style={s.fileRow}
                activeOpacity={0.75}
                onPress={() => openClassworkAttachment(data.classwork_id, a.classwork_attachment_id)}
              >
                <Ionicons name="document-outline" size={16} color={AppColors.primary} />
                <Text style={s.fileName} numberOfLines={1}>{a.file_name}</Text>
                <Ionicons name="open-outline" size={16} color={AppColors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Submission status */}
        {submission && (
          <View style={s.statusCard}>
            <Text style={s.sectionLabel}>Your Submission</Text>
            <View style={[s.statusBadge, { backgroundColor: statusColors[submission.status] || '#6b7280' }]}>
              <Text style={s.statusBadgeText}>{submission.status.toUpperCase()}</Text>
            </View>
            {submission.attachments?.map((a: any) => (
              <TouchableOpacity
                key={a.submission_attachment_id}
                style={s.fileRow}
                activeOpacity={0.75}
                onPress={() => openSubmissionAttachment(submission.submission_id, a.submission_attachment_id)}
                disabled={isDraft || removingAttachmentId === a.submission_attachment_id}
              >
                <Ionicons name="document-outline" size={16} color={AppColors.primary} />
                <Text style={s.fileName} numberOfLines={1}>{a.file_name}</Text>
                {isDraft ? (
                  removingAttachmentId === a.submission_attachment_id ? (
                    <ActivityIndicator size="small" color={AppColors.destructive} />
                  ) : (
                    <TouchableOpacity
                      onPress={() => handleRemoveSavedAttachment(a.submission_attachment_id)}
                      style={s.removeFileButton}
                    >
                      <Ionicons name="close-circle" size={18} color={AppColors.destructive} />
                    </TouchableOpacity>
                  )
                ) : (
                  <Ionicons name="open-outline" size={16} color={AppColors.mutedForeground} />
                )}
              </TouchableOpacity>
            ))}
            {isGraded && (
              <View style={s.gradeBox}>
                <Text style={s.gradeTitle}>Grade: {submission.grade}/{data.total_points}</Text>
                {submission.feedback && <Text style={s.feedbackText}>{submission.feedback}</Text>}
              </View>
            )}
          </View>
        )}

        {canUnsubmit && (
          <View style={s.section}>
            <TouchableOpacity
              style={[s.unsubmitButton, unsubmitting && { opacity: 0.7 }]}
              onPress={handleUnsubmit}
              disabled={unsubmitting}
            >
              {unsubmitting ? (
                <ActivityIndicator color={AppColors.destructive} />
              ) : (
                <>
                  <Ionicons name="arrow-undo-outline" size={20} color={AppColors.destructive} />
                  <Text style={s.unsubmitText}>Unsubmit</Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={s.hintText}>
              Withdraw your submission to edit files before submitting again.
            </Text>
          </View>
        )}

        {canSubmitDraft && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>
              {hasSavedDraftFiles ? 'Your Draft' : 'Submit Your Work'}
            </Text>
            {hasSavedDraftFiles && (
              <Text style={s.hintText}>
                Files below are saved on the server. Add more or tap Submit when ready.
              </Text>
            )}
            <TouchableOpacity style={s.fileButton} onPress={pickFile}>
              <Ionicons name="cloud-upload-outline" size={20} color={AppColors.foreground} />
              <Text style={s.fileButtonText}>Add Files (4MB max)</Text>
            </TouchableOpacity>
            {files.map((f, i) => (
              <View key={i} style={s.fileRow}>
                <Ionicons name="document-outline" size={16} color={AppColors.mutedForeground} />
                <Text style={s.fileName} numberOfLines={1}>{f.name}</Text>
                <TouchableOpacity onPress={() => setFiles((p) => p.filter((_, idx) => idx !== i))}>
                  <Ionicons name="close-circle" size={18} color={AppColors.destructive} />
                </TouchableOpacity>
              </View>
            ))}
            {(files.length > 0 || hasSavedDraftFiles) && (
              <TouchableOpacity
                style={[s.submitButton, submitting && { opacity: 0.7 }]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color={AppColors.primaryForeground} />
                ) : (
                  <Text style={s.submitText}>Submit</Text>
                )}
              </TouchableOpacity>
            )}
            {submitting && (
              <TouchableOpacity
                style={[s.cancelSubmitButton, cancelRequested && { opacity: 0.7 }]}
                onPress={handleCancelSubmit}
                disabled={cancelRequested}
              >
                <Ionicons name="arrow-undo-outline" size={20} color={AppColors.destructive} />
                <Text style={s.cancelSubmitText}>{cancelRequested ? 'Cancelling...' : 'Unsubmit'}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!isGraded && !canUnsubmit && !canSubmitDraft && isPastDue && (
          <Text style={s.hintText}>The due date has passed. You can no longer change this submission.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 14, borderBottomWidth: Borders.width, borderBottomColor: AppColors.border },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  content: { padding: Spacing.lg, gap: 16, paddingBottom: 40 },
  typeBadge: { backgroundColor: AppColors.primary, paddingHorizontal: 12, paddingVertical: 4, alignSelf: 'flex-start', borderWidth: 1, borderColor: AppColors.border },
  typeBadgeText: { fontSize: 12, fontWeight: '800', color: AppColors.primaryForeground },
  title: { fontSize: 22, fontWeight: '900', color: AppColors.foreground },
  meta: { fontSize: 13, color: AppColors.mutedForeground },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dueText: { fontSize: 13, fontWeight: '600', color: AppColors.destructive },
  section: { gap: 8 },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  bodyText: { fontSize: 15, color: AppColors.foreground, lineHeight: 22 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderWidth: 1, borderColor: AppColors.border, backgroundColor: AppColors.card },
  fileName: { flex: 1, fontSize: 13, color: AppColors.foreground },
  removeFileButton: { padding: 4 },
  statusCard: { gap: 8, padding: 16, borderWidth: Borders.width, borderColor: AppColors.border, backgroundColor: AppColors.accent },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', borderRadius: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  gradeBox: { gap: 4, marginTop: 8, padding: 12, backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#86efac' },
  gradeTitle: { fontSize: 18, fontWeight: '900', color: '#16a34a' },
  feedbackText: { fontSize: 14, color: AppColors.foreground, lineHeight: 20 },
  fileButton: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderWidth: Borders.width, borderColor: AppColors.border, borderStyle: 'dashed' },
  fileButtonText: { fontSize: 13, color: AppColors.mutedForeground, flex: 1 },
  submitButton: { backgroundColor: AppColors.primary, borderWidth: Borders.width, borderColor: AppColors.border, paddingVertical: 14, alignItems: 'center', ...NeoShadow.md },
  submitText: { fontSize: 16, fontWeight: '900', color: AppColors.primaryForeground },
  unsubmitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderWidth: Borders.width,
    borderColor: AppColors.destructive,
    backgroundColor: AppColors.card,
  },
  unsubmitText: { fontSize: 16, fontWeight: '800', color: AppColors.destructive },
  cancelSubmitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderWidth: Borders.width,
    borderColor: AppColors.destructive,
    backgroundColor: AppColors.card,
  },
  cancelSubmitText: { fontSize: 16, fontWeight: '800', color: AppColors.destructive },
  hintText: { fontSize: 13, color: AppColors.mutedForeground, lineHeight: 18 },
  errorText: { fontSize: 14, color: AppColors.destructive, textAlign: 'center', marginTop: 24 },
});
