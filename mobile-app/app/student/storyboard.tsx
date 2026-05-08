import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '@/components/student/ScreenHeader';
import SubjectCard from '@/components/student/SubjectCard';
import { AppColors, NeoShadow, Spacing } from '@/constants/theme';
import { useStudentSubjects } from '@/hooks/useStudentSubjects';

const StoryBoard = () => {
  const router = useRouter();
  const { subjects, isLoading, error, refresh } = useStudentSubjects();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Study Board" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} />}
      >
        {/* Subject Cards */}
        <View style={styles.grid}>
          {isLoading && subjects.length === 0 ? (
            <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 32 }} />
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : subjects.length === 0 ? (
            <Text style={styles.emptyText}>No subjects enrolled yet.</Text>
          ) : (
            subjects.map((s) => (
              <SubjectCard
                key={s.subject_load_id}
                title={s.subject_name}
                teacher={s.teacher_name}
                quarter={s.period_name}
                badges={[]}
                onPress={() =>
                  router.push({
                    pathname: '/student/subject-detail' as any,
                    params: {
                      subject_load_id: s.subject_load_id,
                      subject: s.subject_name,
                      teacher: s.teacher_name,
                      period: s.period_name,
                      section: s.section_name,
                    },
                  })
                }
              />
            ))
          )}
        </View>

        {/* To Do Section */}
        <View style={styles.todoSection}>
          <View style={styles.todoHeader}>
            <Text style={styles.todoTitle}>To do</Text>
            <TouchableOpacity
              onPress={() => router.push('/student/todo' as any)}
              style={styles.todoButton}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-forward" size={18} color={AppColors.foreground} />
            </TouchableOpacity>
          </View>
          <Text style={styles.todoEmpty}>No urgent tasks right now 🎉</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: AppColors.background },
  container:        { flex: 1 },
  contentContainer: { paddingBottom: 32 },
  grid:             { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, gap: 16 },
  errorText:        { fontSize: 14, color: AppColors.destructive, textAlign: 'center', marginTop: 24 },
  emptyText:        { fontSize: 14, color: AppColors.mutedForeground, textAlign: 'center', marginTop: 24 },
  todoSection: {
    marginHorizontal: Spacing.lg, marginTop: Spacing.lg,
    borderWidth: 2, borderColor: AppColors.border, borderRadius: 8,
    padding: Spacing.lg, backgroundColor: AppColors.card,
    shadowColor: AppColors.black, ...NeoShadow.lg,
  },
  todoHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  todoTitle:   { fontSize: 22, fontWeight: '700', color: AppColors.foreground },
  todoButton:  { borderWidth: 2, borderColor: AppColors.border, borderRadius: 999, padding: 6 },
  todoEmpty:   { marginTop: 12, fontSize: 14, color: AppColors.mutedForeground },
});

export default StoryBoard;
