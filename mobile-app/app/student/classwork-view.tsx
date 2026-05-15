import React, { useEffect, useState } from 'react';
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

const BANNER_BG = '#F6E9B2';
const POINTS_BG = '#fef08a';
const PUBLISHED_BG = '#dcfce7';
const LOCKED_BG = '#fecaca';

function cwTypeIcon(t: string): keyof typeof Ionicons.glyphMap {
  const u = (t || '').toUpperCase();
  if (u.includes('QUIZ') || u.includes('EXAM')) return 'help-circle-outline';
  if (u.includes('ACTIVITY')) return 'code-slash-outline';
  if (u.includes('ASSIGNMENT')) return 'laptop-outline';
  return 'document-text-outline';
}

export default function ClassworkView() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ assignment_id?: string }>();
  const [data, setData] = useState<any>(null);
  const [submission, setSubmission] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<{ uri: string; name: string; type: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

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

  const handleSubmit = async () => {
    if (files.length === 0) { Alert.alert('Error', 'Pick at least one file'); return; }
    setSubmitting(true);
    try {
      const result = await apiUpload(`/api/v1/submissions/assignment/${params.assignment_id}/submit`, files, session!.token);
      setSubmission(result); setFiles([]);
      Alert.alert('Success', 'Submission uploaded!');
    } catch (e: any) { Alert.alert('Error', e.message); } finally { setSubmitting(false); }
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

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>Classwork</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {/* ── Hero card ── */}
        <View style={s.hero}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <View style={s.heroIconWrap}>
              <Ionicons name={cwTypeIcon(data.classwork_type)} size={20} color={AppColors.foreground} />
            </View>
            <Text style={[s.heroTitle, { marginBottom: 8 }]}>{data.title}</Text>
          </View>


          <View style={s.typeRow}>
            <View style={s.typeBadge}>
              <Text style={s.typeBadgeText}>{data.classwork_type}</Text>
            </View>
            {data.classwork_category ? (
              <View style={s.catBadge}>
                <Text style={s.catBadgeText} numberOfLines={1}>
                  {data.classwork_category.replace(/_/g, ' ')}
                </Text>
              </View>
            ) : null}
            <View style={s.pointsBadge}>
              <Text style={s.pointsBadgeText}>{data.total_points} pts</Text>
            </View>
          </View>
          <View style={s.metaRow}>
            {data.subject_name ? (
              <View style={s.metaChip}>
                <Ionicons name="book-outline" size={14} color={AppColors.foreground} />
                <Text style={s.metaChipText} numberOfLines={1}>
                  {data.subject_name}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={s.dateRow}>
            <Text style={s.dateText}>
              {data.due_date && <View style={s.dueRow}><Ionicons name="time-outline" size={16} color={AppColors.destructive} /><Text style={s.dueText}>Due: {new Date(data.due_date).toLocaleString()}</Text></View>}
            </Text>
          </View>
        </View>
        {data.instructions &&
          <View style={s.block}>
            <View style={s.blockHead}>
              <Ionicons name="list-outline" size={18} color={AppColors.foreground} />
              <Text style={s.blockTitle}>Instructions</Text>
            </View>
            <Text style={s.blockBody}>{data.instructions}</Text>
          </View>
        }

        {data.attachments?.length > 0 ? (
          <View style={s.block}>
            <View style={s.blockHead}>
              <Ionicons name="attach-outline" size={18} color={AppColors.foreground} />
              <Text style={s.blockTitle}>Attachments ({data.attachments.length})</Text>
            </View>
            {data.attachments.map((a: any) => (
              <TouchableOpacity
                key={a.classwork_attachment_id}
                style={s.fileCard}
                activeOpacity={0.75}
                onPress={() => openClassworkAttachment(data.classwork_id, a.classwork_attachment_id)}
              >
                <View style={s.fileIconWrap}>
                  <Ionicons
                    name="document-outline"
                    size={24}
                    color={AppColors.foreground}
                  />
                </View>
                <Text style={s.fileName2} numberOfLines={1}>{a.file_name}</Text>
                <Ionicons name="open-outline" size={16} color={AppColors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* Submission status */}
        {submission && (
          <View style={s.statusCard}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={s.blockHead}>
                <Ionicons name="document-text-outline" size={18} color={AppColors.foreground} />
                <Text style={s.blockTitle}>Your Submission</Text>
              </View>
              <View style={[s.statusBadge, { backgroundColor: statusColors[submission.status] || '#6b7280' }]}>
                <Text style={s.statusBadgeText}>{submission.status.toUpperCase()}</Text>
              </View>
            </View>

            {submission.attachments?.map((a: any) => (
              <TouchableOpacity
                key={a.submission_attachment_id}
                style={s.fileCard}
                activeOpacity={0.75}
                onPress={() => openSubmissionAttachment(submission.submission_id, a.submission_attachment_id)}
              >
                <View style={s.fileIconWrap}>
                  <Ionicons
                    name="document-outline"
                    size={24}
                    color={AppColors.foreground}
                  />
                </View>
                <Text style={s.fileName} numberOfLines={1}>{a.file_name}</Text>
                <Ionicons name="open-outline" size={16} color={AppColors.mutedForeground} />
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

        {/* Submit section */}
        {!isGraded && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>{submission ? 'Resubmit' : 'Submit Your Work'}</Text>
            <TouchableOpacity style={s.fileButton} onPress={pickFile}>
              <Ionicons name="cloud-upload-outline" size={20} color={AppColors.foreground} />
              <Text style={s.fileButtonText}>Pick Files (4MB max)</Text>
            </TouchableOpacity>
            {files.map((f, i) => (
              <View key={i} style={s.fileRow}>
                <Ionicons name="document-outline" size={16} color={AppColors.mutedForeground} />
                <Text style={s.fileName} numberOfLines={1}>{f.name}</Text>
                <TouchableOpacity onPress={() => setFiles((p) => p.filter((_, idx) => idx !== i))}><Ionicons name="close-circle" size={18} color={AppColors.destructive} /></TouchableOpacity>
              </View>
            ))}
            {files.length > 0 && (
              <TouchableOpacity style={[s.submitButton, submitting && { opacity: 0.7 }]} onPress={handleSubmit} disabled={submitting}>
                {submitting ? <ActivityIndicator color={AppColors.primaryForeground} /> : <Text style={s.submitText}>Submit</Text>}
              </TouchableOpacity>
            )}
          </View>
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
  content: { padding: Spacing.md, gap: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '900', color: AppColors.foreground },
  meta: { fontSize: 13, color: AppColors.mutedForeground },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dueText: { fontSize: 13, fontWeight: '600', color: AppColors.destructive },
  section: { gap: 8 },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  bodyText: { fontSize: 15, color: AppColors.foreground, lineHeight: 22 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderWidth: 1, borderColor: AppColors.border, backgroundColor: AppColors.card },
  fileName: { flex: 1, fontSize: 13, color: AppColors.foreground },
  statusCard: { gap: 8, padding: 16, borderWidth: Borders.width, borderColor: AppColors.border, backgroundColor: BANNER_BG, borderRadius: 12, ...NeoShadow.sm },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', borderRadius: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  gradeBox: { gap: 4, marginTop: 8, padding: 12, backgroundColor: AppColors.background, borderWidth: 2, borderColor: AppColors.border, borderRadius: 6 },
  gradeTitle: { fontSize: 16, fontWeight: '600' },
  feedbackText: { fontSize: 14, color: AppColors.foreground, lineHeight: 20 },
  fileButton: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderWidth: Borders.width, borderColor: AppColors.border, borderStyle: 'dashed' },
  fileButtonText: { fontSize: 13, color: AppColors.mutedForeground, flex: 1 },
  submitButton: { backgroundColor: AppColors.primary, borderWidth: Borders.width, borderColor: AppColors.border, paddingVertical: 14, alignItems: 'center', ...NeoShadow.md },
  submitText: { fontSize: 16, fontWeight: '900', color: AppColors.primaryForeground },
  errorText: { fontSize: 14, color: AppColors.destructive, textAlign: 'center', marginTop: 24 },

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
  dateRow: { flexDirection: 'row', flexWrap: 'wrap' },
  dateText: { fontSize: 12, color: AppColors.mutedForeground },
  dateLabel: { fontWeight: '700', color: AppColors.foreground, marginRight: 4 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 },
  catBadgeText: { fontSize: 11, fontWeight: '800', color: AppColors.foreground, textTransform: 'capitalize' },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
  },
  typeBadgeText: { fontSize: 12, fontWeight: '900', color: AppColors.primaryForeground },
  pointsBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
  },
  pointsBadgeText: { fontSize: 12, fontWeight: '900', color: AppColors.foreground },
  catBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
  },
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
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.white,
    borderRadius: 6,
  },
  fileIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: '#F6E9B2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: {
    flex: 1,
    gap: 2,
  },
  fileName2: {
    fontSize: 14,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  fileSize: {
    fontSize: 12,
    color: AppColors.mutedForeground,
  },
});
