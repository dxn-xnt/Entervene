import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDrawer } from '@/context/DrawerContext';
import { useTeacherLessons } from '@/hooks/useTeacherData';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

export default function TeacherLessons() {
  const { openDrawer } = useDrawer();
  const router = useRouter();
  const { lessons, isLoading, error, refresh } = useTeacherLessons();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
            <Ionicons name="menu" size={24} color={AppColors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>Lessons</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/teacher/create-lesson' as any)}
          style={styles.addButton}
          activeOpacity={0.8}
        >
          <Text style={styles.addButtonText}>+ New Lesson</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} />}
      >
        {isLoading && lessons.length === 0 ? (
          <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 32 }} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : lessons.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={48} color={AppColors.muted} />
            <Text style={styles.emptyText}>No lessons yet</Text>
            <Text style={styles.emptySubtext}>Tap &quot;+ New Lesson&quot; to create one</Text>
          </View>
        ) : (
          lessons.map((l) => (
            <TouchableOpacity
              key={l.lesson_id}
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: '/teacher/lesson-detail' as any, params: { lesson_id: l.lesson_id } })}
            >
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{l.title}</Text>
                <Text style={styles.cardMeta}>{l.subject_name}</Text>
                {l.description ? <Text style={styles.cardDesc} numberOfLines={2}>{l.description}</Text> : null}
              </View>
              <View style={styles.cardRight}>
                <View style={[styles.statusBadge, l.is_published ? styles.published : styles.draft]}>
                  <Text style={styles.statusText}>{l.is_published ? 'Published' : 'Draft'}</Text>
                </View>
                {l.attachments.length > 0 && (
                  <View style={styles.attachBadge}>
                    <Ionicons name="attach" size={14} color={AppColors.mutedForeground} />
                    <Text style={styles.attachText}>{l.attachments.length}</Text>
                  </View>
                )}
              </View>
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
  addButton: {
    paddingVertical: 6, paddingHorizontal: 12,
    backgroundColor: AppColors.primary, borderWidth: Borders.width,
    borderColor: AppColors.border, ...NeoShadow.sm,
  },
  addButtonText: { fontSize: 13, fontWeight: '700', color: AppColors.primaryForeground },
  content: { padding: Spacing.lg, gap: 12, paddingBottom: 32 },
  errorText: { fontSize: 14, color: AppColors.destructive, textAlign: 'center', marginTop: 24 },
  emptyState: { alignItems: 'center', marginTop: 60, gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  emptySubtext: { fontSize: 14, color: AppColors.mutedForeground },
  card: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderWidth: Borders.width, borderColor: AppColors.border,
    backgroundColor: AppColors.card, ...NeoShadow.sm,
  },
  cardContent: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: AppColors.foreground },
  cardMeta: { fontSize: 12, fontWeight: '600', color: AppColors.mutedForeground },
  cardDesc: { fontSize: 13, color: AppColors.mutedForeground, marginTop: 4 },
  cardRight: { alignItems: 'flex-end', gap: 6, marginLeft: 12 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: AppColors.border },
  published: { backgroundColor: '#dcfce7' },
  draft: { backgroundColor: AppColors.muted },
  statusText: { fontSize: 11, fontWeight: '700' },
  attachBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  attachText: { fontSize: 12, color: AppColors.mutedForeground },
});
