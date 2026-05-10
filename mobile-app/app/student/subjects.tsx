import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '@/components/student/ScreenHeader';
import SubjectCard from '@/components/student/SubjectCard';
import { AppColors, Spacing } from '@/constants/theme';
import { useStudentSubjects } from '@/hooks/useStudentSubjects';

const Subjects = () => {
  const router = useRouter();
  const { subjects, isLoading, error, refresh } = useStudentSubjects();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Subjects" />
      {isLoading && subjects.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={AppColors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : subjects.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No subjects enrolled yet.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refresh} />
          }
        >
          {subjects.map((s) => (
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
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  content: { padding: Spacing.md, gap: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.md },
  errorText: { fontSize: 14, color: AppColors.destructive, textAlign: 'center' },
  emptyText: { fontSize: 14, color: AppColors.mutedForeground, textAlign: 'center' },
});

export default Subjects;
