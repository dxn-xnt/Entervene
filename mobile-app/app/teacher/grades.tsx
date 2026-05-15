import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDrawer } from '@/context/DrawerContext';
import { useTeacherClasses } from '@/hooks/useTeacherData';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

// Card background matching the web's tan/cream colour
const CARD_BG = '#F6E9B2';

export default function TeacherGrades() {
  const { openDrawer } = useDrawer();
  const router = useRouter();
  const { classes, isLoading } = useTeacherClasses();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
            <Ionicons name="menu" size={24} color={AppColors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>Grades</Text>
        </View>
        {/* Export button matching web */}
        <TouchableOpacity style={styles.exportBtn} activeOpacity={0.8}>
          <Ionicons name="share-outline" size={15} color="#fff" />
          <Text style={styles.exportText}>Export Grade</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => {}} />}
      >
        {isLoading ? (
          <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 40 }} />
        ) : classes.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="bar-chart-outline" size={44} color={AppColors.mutedForeground} />
            <Text style={styles.emptyText}>No classes assigned yet</Text>
          </View>
        ) : (
          classes.map((c) => (
            <TouchableOpacity
              key={c.subject_load_id}
              style={styles.card}
              activeOpacity={0.8}
              onPress={() =>
                router.push({
                  pathname: '/teacher/subject-detail' as any,
                  params: {
                    subject_load_id: c.subject_load_id,
                    class_id:        c.class_id,
                    subject_id:      c.subject_id,
                    subject:         c.subject_name,
                    section:         c.section_name,
                    view:            'grades',
                  },
                })
              }
            >
              <View style={styles.cardContent}>
                <Text style={styles.sectionName}>{c.section_name}</Text>
                <Text style={styles.subjectName}>{c.subject_name}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={AppColors.mutedForeground} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: 14,
    borderBottomWidth: Borders.width, borderBottomColor: AppColors.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#4caf50', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8, ...NeoShadow.sm,
  },
  exportText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  content: { padding: Spacing.md, gap: 10, paddingBottom: 40 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD_BG,
    borderWidth: Borders.width, borderColor: AppColors.border, borderRadius: 10,
    padding: 16, ...NeoShadow.sm,
  },
  cardContent: { flex: 1, gap: 3 },
  sectionName: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  subjectName: { fontSize: 12, color: AppColors.mutedForeground },
  emptyBox:   { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText:  { fontSize: 14, color: AppColors.mutedForeground },
});
