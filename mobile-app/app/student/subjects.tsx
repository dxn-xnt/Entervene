import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '@/components/student/ScreenHeader';
import SubjectCard from '@/components/student/SubjectCard';
import { AppColors, Spacing } from '@/constants/theme';

const subjectsData = [
  { title: 'Computer Programming', teacher: 'Juan Dela Cruz', badges: [{ label: 'Quizzes', count: 1 }, { label: 'Assignments', count: 2 }, { label: 'Activities', count: 1 }] },
  { title: 'English', teacher: 'Juan Dela Cruz', badges: [{ label: 'Quizzes', count: 1 }, { label: 'Assignments', count: 2 }, { label: 'Activities', count: 1 }] },
  { title: 'Science & Technology', teacher: 'Juan Dela Cruz', badges: [{ label: 'Quizzes', count: 1 }, { label: 'Assignments', count: 2 }, { label: 'Activities', count: 1 }] },
  { title: 'Mathematics', teacher: 'Juan Dela Cruz', badges: [{ label: 'Quizzes', count: 1 }, { label: 'Assignments', count: 2 }, { label: 'Activities', count: 1 }] },
  { title: 'Filipino', teacher: 'Juan Dela Cruz', badges: [{ label: 'Quizzes', count: 1 }, { label: 'Assignments', count: 2 }, { label: 'Activities', count: 1 }] },
];

const Subjects = () => {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Subjects" />
      <ScrollView contentContainerStyle={styles.content}>
        {subjectsData.map((s) => (
          <SubjectCard
            key={s.title}
            title={s.title}
            teacher={s.teacher}
            badges={s.badges}
            onPress={() => router.push({ pathname: '/student/subject-detail' as any, params: { subject: s.title } })}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  content: { padding: Spacing.lg, gap: 16, paddingBottom: 32 },
});

export default Subjects;
