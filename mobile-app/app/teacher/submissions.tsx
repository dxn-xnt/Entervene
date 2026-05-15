import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SubmissionTrackingStudent, useAssignmentSubmissionTracking } from '@/hooks/useSubmissions';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

const statusColors: Record<string, string> = { pending: '#f59e0b', submitted: '#3b82f6', graded: '#22c55e', late: '#ef4444', missed: '#6b7280', not_submitted: '#6b7280' };

function formatDate(iso: string | null) {
  if (!iso) return 'Not submitted';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Submissions() {
  const router = useRouter();
  const params = useLocalSearchParams<{ assignment_id?: string; classwork_title?: string; total_points?: string }>();
  const assignmentId = parseInt(params.assignment_id || '0');
  const { tracking, isLoading, error, refresh } = useAssignmentSubmissionTracking(assignmentId);

  const submitted = tracking?.submitted ?? [];
  const missing = tracking?.missing ?? [];

  const renderStudent = (student: SubmissionTrackingStudent, submittedRow: boolean) => (
    <TouchableOpacity
      key={student.student_id}
      style={[s.card, !submittedRow && s.missingCard]}
      activeOpacity={submittedRow ? 0.8 : 1}
      disabled={!submittedRow || !student.submission_id}
      onPress={() =>
        student.submission_id &&
        router.push({
          pathname: '/teacher/grade-submission' as any,
          params: {
            submission_id: student.submission_id,
            student_name: student.student_name,
            classwork_title: tracking?.classwork_title || params.classwork_title,
            total_points: params.total_points,
          },
        })
      }
    >
      <View style={s.cardContent}>
        <Text style={s.cardName}>{student.student_name || 'Unknown'}</Text>
        <Text style={s.cardDate}>
          {submittedRow ? formatDate(student.submitted_at) : student.email || student.student_lrn || 'No submission yet'}
        </Text>
        {submittedRow ? (
          <Text style={s.fileText}>
            {student.attachment_count} file(s) · Attempt {student.attempt_count}
            {student.grade !== null ? ` · Grade ${student.grade}/${params.total_points || '100'}` : ''}
          </Text>
        ) : null}
      </View>
      <View style={[s.statusBadge, { backgroundColor: statusColors[student.status] || '#6b7280' }]}>
        <Text style={s.statusText}>{submittedRow ? student.status.toUpperCase() : 'NOT SUBMITTED'}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>Submissions</Text>
        </TouchableOpacity>
      </View>
      {(tracking?.classwork_title || params.classwork_title) && (
        <Text style={s.subtitle}>{tracking?.classwork_title || params.classwork_title}</Text>
      )}
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} />}>
        {isLoading && !tracking ? (
          <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 32 }} />
        ) : error ? (
          <Text style={s.errorText}>{error}</Text>
        ) : !tracking ? (
          <View style={s.emptyState}><Ionicons name="people-outline" size={48} color={AppColors.muted} /><Text style={s.emptyText}>No roster found</Text></View>
        ) : (
          <>
            <View style={s.summaryRow}>
              <View style={s.summaryBox}>
                <Text style={s.summaryValue}>{tracking.submitted_count}</Text>
                <Text style={s.summaryLabel}>Submitted</Text>
              </View>
              <View style={s.summaryBox}>
                <Text style={s.summaryValue}>{tracking.missing_count}</Text>
                <Text style={s.summaryLabel}>Not Submitted</Text>
              </View>
              <View style={s.summaryBox}>
                <Text style={s.summaryValue}>{tracking.total_students}</Text>
                <Text style={s.summaryLabel}>Students</Text>
              </View>
            </View>

            <View style={s.sectionHeader}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#166534" />
              <Text style={s.sectionTitle}>Submitted Students</Text>
            </View>
            {submitted.length === 0 ? (
              <Text style={s.emptyInline}>No students have submitted yet.</Text>
            ) : (
              submitted.map((student) => renderStudent(student, true))
            )}

            <View style={s.sectionHeader}>
              <Ionicons name="close-circle-outline" size={18} color="#991b1b" />
              <Text style={s.sectionTitle}>Missing / Not Submitted</Text>
            </View>
            {missing.length === 0 ? (
              <Text style={s.emptyInline}>Everyone has submitted.</Text>
            ) : (
              missing.map((student) => renderStudent(student, false))
            )}
          </>
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
  subtitle: { fontSize: 14, color: AppColors.mutedForeground, paddingHorizontal: Spacing.lg, paddingTop: 8, fontWeight: '600' },
  content: { padding: Spacing.lg, gap: 12, paddingBottom: 32 },
  errorText: { fontSize: 14, color: AppColors.destructive, textAlign: 'center', marginTop: 24 },
  emptyState: { alignItems: 'center', marginTop: 60, gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  summaryBox: { flex: 1, padding: 12, borderWidth: Borders.width, borderColor: AppColors.border, borderRadius: 8, backgroundColor: AppColors.card, ...NeoShadow.xs },
  summaryValue: { fontSize: 20, fontWeight: '900', color: AppColors.foreground },
  summaryLabel: { fontSize: 11, fontWeight: '700', color: AppColors.mutedForeground, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '900', color: AppColors.foreground },
  emptyInline: { fontSize: 13, color: AppColors.mutedForeground, paddingVertical: 8 },
  card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 16, borderWidth: Borders.width, borderColor: AppColors.border, backgroundColor: AppColors.card, ...NeoShadow.sm },
  missingCard: { backgroundColor: AppColors.inputBackground, opacity: 0.88 },
  cardContent: { flex: 1, gap: 2 },
  cardName: { fontSize: 15, fontWeight: '700', color: AppColors.foreground },
  cardDate: { fontSize: 12, color: AppColors.mutedForeground },
  fileText: { fontSize: 12, fontWeight: '700', color: AppColors.foreground, marginTop: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  statusText: { fontSize: 10, fontWeight: '800', color: '#fff' },
});
