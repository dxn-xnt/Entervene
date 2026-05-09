import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '@/components/student/ScreenHeader';
import SubjectCard from '@/components/student/SubjectCard';
import { AppColors, NeoShadow, Spacing } from '@/constants/theme';

const StoryBoard = () => {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Study Board" />
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        {/* Subject Cards */}
        <View style={styles.grid}>
          <SubjectCard
            title="Computer Programming"
            teacher="Juan Dela Cruz"
            badges={[
              { label: 'Quizzes', count: 1 },
              { label: 'Assignments', count: 2 },
              { label: 'Activities', count: 1 },
            ]}
            onPress={() => router.push('/student/subjects' as any)}
          />
          <SubjectCard
            title="English"
            teacher="Marie Tess"
            badges={[
              { label: 'Assignments', count: 1 },
              { label: 'Readings', count: 1 },
            ]}
            onPress={() => router.push('/student/subjects' as any)}
          />
          <SubjectCard
            title="Science & Technology"
            teacher="Jose Rizal"
            badges={[{ label: 'Tasks All Completed', count: 0 }]}
            onPress={() => router.push('/student/subjects' as any)}
          />
          <SubjectCard
            title="Mathematics"
            teacher="Maria Clara"
            badges={[
              { label: 'Activities', count: 1 },
              { label: 'Readings', count: 1 },
            ]}
            onPress={() => router.push('/student/subjects' as any)}
          />
          <SubjectCard
            title="Filipino"
            teacher="Maripusa"
            badges={[
              { label: 'Quizzes', count: 1 },
              { label: 'Readings', count: 1 },
            ]}
            onPress={() => router.push('/student/subjects' as any)}
          />
          <SubjectCard
            title="System Designs"
            teacher="Alden Richards"
            badges={[{ label: 'Tasks All Completed', count: 0 }]}
            onPress={() => router.push('/student/subjects' as any)}
          />
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
  safe: { flex: 1, backgroundColor: AppColors.background },
  container: { flex: 1 },
  contentContainer: { paddingBottom: 32 },
  grid: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, gap: 16 },
  todoSection: {
    marginHorizontal: Spacing.lg, marginTop: Spacing.lg,
    borderWidth: 2, borderColor: AppColors.border, borderRadius: 8,
    padding: Spacing.lg, backgroundColor: AppColors.card,
    shadowColor: AppColors.black, ...NeoShadow.lg,
  },
  todoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  todoTitle: { fontSize: 22, fontWeight: '700', color: AppColors.foreground },
  todoButton: { borderWidth: 2, borderColor: AppColors.border, borderRadius: 999, padding: 6 },
  todoEmpty: { marginTop: 12, fontSize: 14, color: AppColors.mutedForeground },
});

export default StoryBoard;
