import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StyleSheet, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDrawer } from '@/context/DrawerContext';
import { useTeacherClasses, useTeacherClassworks } from '@/hooks/useTeacherData';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';
import { useTeacherAcademicYear } from '@/hooks/useTeacherAcademicYear';

const CARD_BG = '#F6E9B2';
const SCREEN_W = Dimensions.get('window').width;
const CARD_W = (SCREEN_W - Spacing.md * 2 - 12) / 2; // 2-col gap 12

function badgeColor(type: string) {
  if (type === 'QUIZ') return { bg: '#fecaca', text: '#991b1b' };
  if (type === 'ACTIVITY') return { bg: '#bbf7d0', text: '#166534' };
  if (type === 'ASSIGNMENT') return { bg: '#fef08a', text: '#854d0e' };
  return { bg: AppColors.muted, text: AppColors.mutedForeground };
}

export default function TeacherDashboard() {
  const { openDrawer } = useDrawer();
  const router = useRouter();
  const { classes, isLoading: isClassesLoading, error: classesError } = useTeacherClasses();
  const { classworks, isLoading: isClassworksLoading, error: classworksError } = useTeacherClassworks();

  const loading = isClassesLoading || isClassworksLoading;
  const error = classesError || classworksError;

  const cwBySubject = React.useMemo(() => {
    const counts: Record<string, Record<string, number>> = {};
    classworks.forEach((cw) => {
      const subjectId = String(cw.subject_id);
      const type = cw.classwork_type?.toUpperCase() ?? 'OTHER';
      counts[subjectId] = counts[subjectId] || {};
      counts[subjectId][type] = (counts[subjectId][type] ?? 0) + 1;
    });
    return counts;
  }, [classworks]);

  const onRefresh = () => {
    // refresh is not available for classes hook, so just rely on classworks reload for now
  };

  // Group classes under a single year header (the API doesn't return year_label yet,
  // so we show one group labelled "Current Academic Year")
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
            <Ionicons name="menu" size={24} color={AppColors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>Dashboard</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
      >
        {loading ? (
          <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 40 }} />
        ) : classes.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="school-outline" size={48} color={AppColors.mutedForeground} />
            <Text style={styles.emptyText}>No classes assigned yet</Text>
          </View>
        ) : (
          <>
            {/* ── 2-col grid of class cards ── */}
            <View style={styles.grid}>
              {classes.map((c) => {
                const counts = cwBySubject[c.subject_id] ?? {};
                const hasWork = Object.keys(counts).length > 0;
                return (
                  <TouchableOpacity
                    key={c.subject_load_id}
                    style={[styles.card, { width: "100%" }]}
                    activeOpacity={0.85}
                    onPress={() =>
                      router.push({
                        pathname: '/teacher/subject-detail' as any,
                        params: {
                          subject_load_id: c.subject_load_id,
                          class_id: c.class_id,
                          subject_id: c.subject_id,
                          subject: c.subject_name,
                          section: c.section_name,
                        },
                      })
                    }
                  >
                    <Text style={styles.cardSection} numberOfLines={2}>{c.section_name}</Text>
                    <Text style={styles.cardSubject} numberOfLines={1}>{c.subject_name}</Text>

                    {/* Classwork type badges */}
                    <View style={styles.badgeRow}>
                      {hasWork ? (
                        Object.entries(counts).map(([type, count]) => {
                          const color = badgeColor(type);
                          return (
                            <View key={type} style={[styles.badge, { backgroundColor: color.bg }]}>
                              <Text style={[styles.badgeText, { color: color.text }]}>
                                {type.charAt(0) + type.slice(1).toLowerCase()} {count}
                              </Text>
                            </View>
                          );
                        })
                      ) : (
                        <View style={[styles.badge, { backgroundColor: '#bbf7d0' }]}>
                          <Ionicons name="checkmark-circle-outline" size={11} color="#166534" />
                          <Text style={[styles.badgeText, { color: '#166534' }]}> No Tasks Assigned</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: AppColors.background,
  },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: 14,
    borderBottomWidth: Borders.width, borderBottomColor: AppColors.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  content: { padding: Spacing.md, gap: 14, paddingBottom: 40 },
  // Year header
  yearHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: CARD_BG,
    borderWidth: Borders.width, borderColor: AppColors.border, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    ...NeoShadow.sm,
  },
  yearLabel: { fontSize: 18, fontWeight: '800', color: AppColors.foreground },
  yearInfo: { padding: 4 },
  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    backgroundColor: CARD_BG,
    borderWidth: Borders.width, borderColor: AppColors.border, borderRadius: 10,
    padding: 14, gap: 6, ...NeoShadow.sm,
  },
  cardSection: { fontSize: 16, fontWeight: '700', color: AppColors.foreground },
  cardSubject: { fontSize: 12, color: AppColors.mutedForeground, marginBottom: 4 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  emptyBox: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { fontSize: 14, color: AppColors.mutedForeground },
});
