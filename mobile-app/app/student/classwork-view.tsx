import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, apiUpload } from '@/hooks/api';
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
        <View style={s.typeBadge}><Text style={s.typeBadgeText}>{data.classwork_type}</Text></View>
        <Text style={s.title}>{data.title}</Text>
        <Text style={s.meta}>{data.teacher_name} · {data.total_points} pts</Text>
        {data.due_date && <View style={s.dueRow}><Ionicons name="time-outline" size={16} color={AppColors.destructive} /><Text style={s.dueText}>Due: {new Date(data.due_date).toLocaleString()}</Text></View>}
        {data.instructions && <View style={s.section}><Text style={s.sectionLabel}>Instructions</Text><Text style={s.bodyText}>{data.instructions}</Text></View>}
        {data.attachments?.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Reference Files</Text>
            {data.attachments.map((a: any) => (<View key={a.classwork_attachment_id} style={s.fileRow}><Ionicons name="document-outline" size={16} color={AppColors.foreground} /><Text style={s.fileName} numberOfLines={1}>{a.file_name}</Text></View>))}
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
              <View key={a.submission_attachment_id} style={s.fileRow}><Ionicons name="document-outline" size={16} color={AppColors.foreground} /><Text style={s.fileName} numberOfLines={1}>{a.file_name}</Text></View>
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
  errorText: { fontSize: 14, color: AppColors.destructive, textAlign: 'center', marginTop: 24 },
});
