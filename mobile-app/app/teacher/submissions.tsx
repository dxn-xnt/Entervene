import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAssignmentSubmissions } from '@/hooks/useSubmissions';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

const statusColors: Record<string, string> = { pending: '#f59e0b', submitted: '#3b82f6', graded: '#22c55e', late: '#ef4444', missed: '#6b7280' };

export default function Submissions() {
  const router = useRouter();
  const params = useLocalSearchParams<{ assignment_id?: string; classwork_title?: string; total_points?: string }>();
  const assignmentId = parseInt(params.assignment_id || '0');
  const { submissions, isLoading, error, refresh } = useAssignmentSubmissions(assignmentId);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>Submissions</Text>
        </TouchableOpacity>
      </View>
      {params.classwork_title && <Text style={s.subtitle}>{params.classwork_title}</Text>}
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} />}>
        {isLoading && submissions.length === 0 ? (
          <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 32 }} />
        ) : error ? (
          <Text style={s.errorText}>{error}</Text>
        ) : submissions.length === 0 ? (
          <View style={s.emptyState}><Ionicons name="people-outline" size={48} color={AppColors.muted} /><Text style={s.emptyText}>No submissions yet</Text></View>
        ) : (
          submissions.map((sub) => (
            <TouchableOpacity key={sub.submission_id} style={s.card} activeOpacity={0.8}
              onPress={() => router.push({ pathname: '/teacher/grade-submission' as any, params: { submission_id: sub.submission_id, student_name: sub.student_name, classwork_title: params.classwork_title, total_points: params.total_points } })}>
              <View style={s.cardContent}>
                <Text style={s.cardName}>{sub.student_name || 'Unknown'}</Text>
                <Text style={s.cardDate}>{sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : 'Not submitted'}</Text>
                {sub.grade !== null && <Text style={s.gradeText}>Grade: {sub.grade}/{params.total_points || '100'}</Text>}
              </View>
              <View style={[s.statusBadge, { backgroundColor: statusColors[sub.status] || '#6b7280' }]}>
                <Text style={s.statusText}>{sub.status.toUpperCase()}</Text>
              </View>
            </TouchableOpacity>
          ))
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
  card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderWidth: Borders.width, borderColor: AppColors.border, backgroundColor: AppColors.card, ...NeoShadow.sm },
  cardContent: { flex: 1, gap: 2 },
  cardName: { fontSize: 15, fontWeight: '700', color: AppColors.foreground },
  cardDate: { fontSize: 12, color: AppColors.mutedForeground },
  gradeText: { fontSize: 13, fontWeight: '700', color: '#22c55e', marginTop: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  statusText: { fontSize: 10, fontWeight: '800', color: '#fff' },
});
