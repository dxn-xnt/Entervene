import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '@/components/student/ScreenHeader';
import TabBar from '@/components/student/TabBar';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';
import { useClassworkAssignments, ClassworkAssignmentItem } from '@/hooks/useClassworkAssignments';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null) {
  if (!dateStr) return 'No due date';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function getDueChip(dueDateStr: string | null): { label: string; bg: string; text: string } {
  if (!dueDateStr) return { label: 'No due date', bg: AppColors.muted, text: AppColors.mutedForeground };
  const diff = Math.ceil((new Date(dueDateStr).getTime() - Date.now()) / 86400000);
  if (diff < 0) return { label: `${Math.abs(diff)}d late`, bg: '#fecaca', text: '#991b1b' };
  if (diff === 0) return { label: 'Due today', bg: '#fed7aa', text: '#9a3412' };
  if (diff === 1) return { label: 'Due tomorrow', bg: '#fed7aa', text: '#9a3412' };
  if (diff <= 3) return { label: `Due in ${diff} days`, bg: '#fef08a', text: '#854d0e' };
  return { label: `Due in ${diff} days`, bg: '#bbf7d0', text: '#166534' };
}

const TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'pastdue', label: 'Past Due' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'graded', label: 'Graded' },
];

// ── Row component ─────────────────────────────────────────────────────────────

function TodoRow({ item, onPress }: { item: ClassworkAssignmentItem; onPress: () => void }) {
  const chip = getDueChip(item.due_date);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.rowLeft}>
        <View style={styles.iconBox}>
          <Ionicons name="document-text-outline" size={16} color={AppColors.foreground} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={2}>{item.classwork_title}</Text>
          <Text style={styles.rowSub}>{item.subject_name} · {formatDate(item.due_date)}</Text>
        </View>
      </View>
      <View style={[styles.chip, { backgroundColor: chip.bg }]}>
        <Text style={[styles.chipText, { color: chip.text }]}>{chip.label}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

const ToDo = () => {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('pending');
  const { assignments, isLoading, error, refresh } = useClassworkAssignments();

  // Past due = pending items whose due_date is in the past
  const pastDue = useMemo(
    () => assignments.pending.filter(
      (a) => a.due_date && new Date(a.due_date) < new Date()
    ),
    [assignments.pending]
  );

  // Pending = not yet past due
  const upcoming = useMemo(
    () => assignments.pending.filter(
      (a) => !a.due_date || new Date(a.due_date) >= new Date()
    ).sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    }),
    [assignments.pending]
  );

  const tabItems: ClassworkAssignmentItem[] =
    activeTab === 'pending' ? upcoming :
      activeTab === 'pastdue' ? pastDue :
        activeTab === 'submitted' ? assignments.submitted :
          assignments.graded;

  const navigateToView = (id: number) =>
    router.push({ pathname: '/student/classwork-view' as any, params: { assignment_id: id } });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="To Do" />
      <TabBar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} />}
      >
        {isLoading && tabItems.length === 0 ? (
          <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={refresh} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : tabItems.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="checkmark-circle-outline" size={44} color={AppColors.mutedForeground} />
            <Text style={styles.emptyText}>
              {activeTab === 'pending' ? 'No upcoming tasks 🎉' :
                activeTab === 'pastdue' ? 'Nothing overdue 🎉' :
                  activeTab === 'submitted' ? 'No submitted work yet' :
                    'No graded work yet'}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {tabItems.map((item) => (
              <TodoRow
                key={item.classwork_assignment_id}
                item={item}
                onPress={() => navigateToView(item.classwork_assignment_id)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background, gap: Spacing.md },
  scroll: { flex: 1, marginTop: -6 },
  content: { padding: Spacing.md, paddingBottom: 40, gap: 12 },
  list: { gap: 10 },
  center: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '600', color: AppColors.mutedForeground },
  errorText: { fontSize: 14, color: AppColors.destructive, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 20, paddingVertical: 8,
    borderRadius: 8, borderWidth: Borders.width, borderColor: AppColors.border,
  },
  retryText: { fontSize: 14, fontWeight: '600', color: AppColors.foreground },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 12,
    borderWidth: Borders.width, borderColor: AppColors.border, borderRadius: 10,
    backgroundColor: AppColors.card,
    gap: 8,
    ...NeoShadow.sm,
  },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: {
    width: 34, height: 34, borderRadius: 8,
    borderWidth: Borders.width, borderColor: AppColors.border,
    backgroundColor: AppColors.muted,
    justifyContent: 'center', alignItems: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  rowSub: { fontSize: 11, color: AppColors.mutedForeground },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  chipText: { fontSize: 11, fontWeight: '700' },
});

export default ToDo;
