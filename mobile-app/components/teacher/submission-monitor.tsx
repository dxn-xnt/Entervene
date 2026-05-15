import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SubmissionTrackingStudent } from '@/hooks/useSubmissions';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

interface SubmissionMonitorProps {
  submitted: SubmissionTrackingStudent[];
  missing: SubmissionTrackingStudent[];
  isLoading?: boolean;
  onStudentPress?: (student: SubmissionTrackingStudent, isSubmitted: boolean) => void;
  classworkTitle?: string;
  totalPoints?: number;
}

const statusColors: Record<string, string> = {
  pending: '#f59e0b',
  submitted: '#3b82f6',
  graded: '#22c55e',
  late: '#ef4444',
  missed: '#6b7280',
  not_submitted: '#6b7280',
};

const formatDate = (iso: string | null): string => {
  if (!iso) return 'Not submitted';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const SubmissionCard: React.FC<{
  student: SubmissionTrackingStudent;
  isSubmitted: boolean;
  onPress: () => void;
  totalPoints: number;
}> = ({ student, isSubmitted, onPress, totalPoints }) => (
  <TouchableOpacity
    style={[s.card, !isSubmitted && s.missingCard]}
    activeOpacity={isSubmitted ? 0.8 : 1}
    disabled={!isSubmitted}
    onPress={onPress}
  >
    <View style={s.cardContent}>
      <Text style={s.cardName} numberOfLines={1}>
        {student.student_name || 'Unknown'}
      </Text>
      <Text style={s.cardDate} numberOfLines={1}>
        {isSubmitted ? formatDate(student.submitted_at) : student.email || 'No submission'}
      </Text>
      {isSubmitted && (
        <View style={s.submissionMeta}>
          <Text style={s.fileText}>
            📎 {student.attachment_count || 0} file(s)
          </Text>
          <Text style={s.fileText}>
            Attempt {student.attempt_count || 1}
          </Text>
          {student.grade !== null ? (
            <Text style={s.gradeText}>
              Grade: {student.grade}/{totalPoints}
            </Text>
          ) : null}
        </View>
      )}
    </View>
    <View
      style={[
        s.statusBadge,
        { backgroundColor: statusColors[student.status] || '#6b7280' },
      ]}
    >
      <Text style={s.statusText}>
        {isSubmitted ? student.status.toUpperCase() : 'MISSING'}
      </Text>
    </View>
  </TouchableOpacity>
);

export default function SubmissionMonitor({
  submitted,
  missing,
  isLoading = false,
  onStudentPress,
  classworkTitle,
  totalPoints = 100,
}: SubmissionMonitorProps) {
  const router = useRouter();

  const handleStudentPress = (student: SubmissionTrackingStudent, isSubmitted: boolean) => {
    if (onStudentPress) {
      onStudentPress(student, isSubmitted);
      return;
    }

    if (isSubmitted && student.submission_id) {
      router.push({
        pathname: '/teacher/grade-submission' as any,
        params: {
          submission_id: student.submission_id,
          student_name: student.student_name,
          classwork_title: classworkTitle,
          total_points: totalPoints,
        },
      });
    }
  };

  if (isLoading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color={AppColors.primary} />
        <Text style={s.loadingText}>Loading submissions...</Text>
      </View>
    );
  }

  const totalStudents = submitted.length + missing.length;

  return (
    <View style={s.container}>
      {/* Summary Stats */}
      <View style={s.summaryRow}>
        <View style={s.summaryBox}>
          <Text style={s.summaryValue}>{submitted.length}</Text>
          <Text style={s.summaryLabel}>Submitted</Text>
        </View>
        <View style={s.summaryBox}>
          <Text style={s.summaryValue}>{missing.length}</Text>
          <Text style={s.summaryLabel}>Missing</Text>
        </View>
        <View style={s.summaryBox}>
          <Text style={s.summaryValue}>{totalStudents}</Text>
          <Text style={s.summaryLabel}>Total</Text>
        </View>
      </View>

      {/* Submitted Section */}
      {submitted.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.sectionHeaderLeft}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#166534" />
              <Text style={s.sectionTitle}>Submitted</Text>
            </View>
            <Text style={s.sectionCount}>{submitted.length}</Text>
          </View>
          <View style={s.studentsList}>
            {submitted.map((student) => (
              <SubmissionCard
                key={student.student_id}
                student={student}
                isSubmitted={true}
                totalPoints={totalPoints}
                onPress={() => handleStudentPress(student, true)}
              />
            ))}
          </View>
        </View>
      )}

      {/* Missing Section */}
      {missing.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <View style={s.sectionHeaderLeft}>
              <Ionicons name="close-circle-outline" size={18} color="#991b1b" />
              <Text style={[s.sectionTitle, s.missingSectionTitle]}>Not Submitted</Text>
            </View>
            <Text style={s.sectionCount}>{missing.length}</Text>
          </View>
          <View style={s.studentsList}>
            {missing.map((student) => (
              <SubmissionCard
                key={student.student_id}
                student={student}
                isSubmitted={false}
                totalPoints={totalPoints}
                onPress={() => handleStudentPress(student, false)}
              />
            ))}
          </View>
        </View>
      )}

      {/* Empty State */}
      {submitted.length === 0 && missing.length === 0 && (
        <View style={s.emptyState}>
          <Ionicons
            name="people-outline"
            size={48}
            color={AppColors.muted}
          />
          <Text style={s.emptyText}>No students assigned</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    gap: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: AppColors.mutedForeground,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryBox: {
    flex: 1,
    padding: 12,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 8,
    backgroundColor: AppColors.card,
    alignItems: 'center',
    ...NeoShadow.xs,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '900',
    color: AppColors.foreground,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: AppColors.mutedForeground,
    marginTop: 2,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: AppColors.foreground,
  },
  missingSectionTitle: {
    color: '#991b1b',
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: '800',
    color: AppColors.mutedForeground,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: AppColors.muted,
    borderRadius: 4,
  },
  studentsList: {
    gap: 8,
  },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    borderRadius: 8,
    ...NeoShadow.sm,
  },
  missingCard: {
    backgroundColor: AppColors.inputBackground,
    opacity: 0.88,
  },
  cardContent: {
    flex: 1,
    gap: 2,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  cardDate: {
    fontSize: 12,
    color: AppColors.mutedForeground,
  },
  submissionMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  fileText: {
    fontSize: 11,
    fontWeight: '600',
    color: AppColors.foreground,
  },
  gradeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: AppColors.foreground,
  },
});
