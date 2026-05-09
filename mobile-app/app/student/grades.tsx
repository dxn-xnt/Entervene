import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '@/components/student/ScreenHeader';
import SubjectCardHeader from '@/components/student/SubjectCardHeader';
import { AppColors, NeoShadow, Spacing } from '@/constants/theme';

const perfData = [
  { subject: 'Mathematics', score: 87 },
  { subject: 'System Des.', score: 89 },
  { subject: 'Science', score: 94 },
  { subject: 'Filipino', score: 94 },
  { subject: 'English', score: 97 },
  { subject: 'Computer P.', score: 99 },
];

const distributionData = [
  { label: 'Readings', color: '#EF4444', pct: 25 },
  { label: 'Quizzes', color: '#F59E0B', pct: 20 },
  { label: 'Assignments', color: '#22C55E', pct: 30 },
  { label: 'Activities', color: '#F97316', pct: 25 },
];

const Grades = () => {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Grades" />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Subject Performance Card */}
        <View style={styles.chartCard}>
          <Text style={styles.cardTitle}>Subject Performance</Text>
          <View style={styles.barList}>
            {perfData.map((item) => (
              <View key={item.subject} style={styles.barRow}>
                <Text style={styles.barLabel}>{item.subject}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${item.score}%` }]} />
                </View>
                <Text style={styles.barScore}>{item.score}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.recommendation}>
            Recommended Attention: <Text style={{ fontWeight: '700' }}>Mathematics</Text>
          </Text>
        </View>

        {/* Classwork Distribution Card */}
        <View style={styles.chartCard}>
          <Text style={styles.cardTitle}>Classwork Distribution</Text>
          {distributionData.map((item) => (
            <View key={item.label} style={styles.distRow}>
              <View style={[styles.distDot, { backgroundColor: item.color }]} />
              <Text style={styles.distLabel}>{item.label}</Text>
              <View style={styles.distTrack}>
                <View style={[styles.distFill, { width: `${item.pct}%`, backgroundColor: item.color }]} />
              </View>
              <Text style={styles.distPct}>{item.pct}%</Text>
            </View>
          ))}
        </View>

        {/* Subject List */}
        <View style={styles.subjectList}>
          {[
            { title: 'Computer Programming', count: '7' },
            { title: 'English', count: '5' },
            { title: 'Science', count: '16' },
            { title: 'System Designs', count: '3' },
            { title: 'Mathematics', count: '12' },
          ].map((s) => (
            <SubjectCardHeader
              key={s.title}
              title={s.title}
              teacher="Raymart Gabutan"
              gradedCount={s.count}
              label="Graded Classwork"
              onPress={() =>
                router.push({ pathname: '/student/subject-grade' as any, params: { subject: s.title } })
              }
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  content: { padding: Spacing.lg, gap: 20, paddingBottom: 32 },
  chartCard: { borderWidth: 2, borderColor: AppColors.border, borderRadius: 8, padding: Spacing.md, backgroundColor: AppColors.card, shadowColor: AppColors.black, ...NeoShadow.lg },
  cardTitle: { fontSize: 16, fontWeight: '700', color: AppColors.foreground, marginBottom: 12 },
  barList: { gap: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { fontSize: 11, width: 80, color: AppColors.foreground },
  barTrack: { flex: 1, height: 12, backgroundColor: '#e5e7eb', borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#D4A017', borderRadius: 999 },
  barScore: { fontSize: 11, fontWeight: '700', width: 24, textAlign: 'right', color: AppColors.foreground },
  recommendation: { fontSize: 11, marginTop: 12, color: AppColors.mutedForeground },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  distDot: { width: 10, height: 10, borderRadius: 5 },
  distLabel: { fontSize: 12, width: 80, color: AppColors.foreground },
  distTrack: { flex: 1, height: 10, backgroundColor: '#e5e7eb', borderRadius: 999, overflow: 'hidden' },
  distFill: { height: '100%', borderRadius: 999 },
  distPct: { fontSize: 11, fontWeight: '600', width: 32, textAlign: 'right', color: AppColors.foreground },
  subjectList: { gap: 12 },
});

export default Grades;
