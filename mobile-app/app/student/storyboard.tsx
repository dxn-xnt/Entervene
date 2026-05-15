import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "@/components/student/ScreenHeader";
import SubjectCard from "@/components/student/SubjectCard";
import { AppColors, NeoShadow, Spacing, Borders } from "@/constants/theme";
import { useStudentSubjects } from "@/hooks/useStudentSubjects";
import {
  useClassworkAssignments,
  ClassworkAssignmentItem,
} from "@/hooks/useClassworkAssignments";

// ── Constants ─────────────────────────────────────────────────────────────────

const SCREEN_W = Dimensions.get("window").width;
const H_PAD    = Spacing.md * 2;
const GAP      = 12;
const CARD_W   = (SCREEN_W - H_PAD - GAP) / 2;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDueDateInfo(dueDateStr: string | null): {
  label: string;
  textColor: string;
  bgColor: string;
} {
  if (!dueDateStr) {
    return { label: "No due date", textColor: AppColors.mutedForeground, bgColor: AppColors.muted };
  }
  const now     = new Date();
  const due     = new Date(dueDateStr);
  const diffMs  = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / 86400000);

  if (diffDays < 0)  return { label: `${Math.abs(diffDays)}d late`,   textColor: "#fff", bgColor: "#ef4444" };
  if (diffDays === 0) return { label: "due today",                     textColor: "#fff", bgColor: "#f97316" };
  if (diffDays === 1) return { label: "due tomorrow",                  textColor: "#fff", bgColor: "#f97316" };
  if (diffDays <= 3)  return { label: `due in ${diffDays} days`,       textColor: "#92400e", bgColor: "#fef08a" };
  return               { label: `due in ${diffDays} days`,             textColor: "#166534", bgColor: "#bbf7d0" };
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase().replace(/_/g, " ");
}

// ── Component ─────────────────────────────────────────────────────────────────

const StoryBoard = () => {
  const router = useRouter();
  const { subjects, isLoading: subjectsLoading, error: subjectsError, refresh: refreshSubjects } =
    useStudentSubjects();
  const { assignments, isLoading: assignmentsLoading, refresh: refreshAssignments } =
    useClassworkAssignments();

  const isLoading = subjectsLoading || assignmentsLoading;
  const refresh   = () => { refreshSubjects(); refreshAssignments(); };

  // Badge counts per subject from ALL assignment statuses
  const subjectBadges = useMemo(() => {
    const all = [
      ...assignments.pending,
      ...assignments.submitted,
      ...assignments.graded,
    ];
    const map: Record<number, Record<string, number>> = {};
    for (const item of all) {
      if (!map[item.subject_id]) map[item.subject_id] = {};
      const t = item.classwork_type;
      map[item.subject_id][t] = (map[item.subject_id][t] ?? 0) + 1;
    }
    return map;
  }, [assignments]);

  // To Do = pending items sorted by due date, capped at 6
  const todoItems = useMemo(
    () =>
      [...assignments.pending]
        .sort((a, b) => {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        })
        .slice(0, 6),
    [assignments.pending]
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title="Study Board" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} />}
      >
        {/* ── Subject Grid ─────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>My Subjects</Text>

        {subjectsLoading && subjects.length === 0 ? (
          <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 20 }} />
        ) : subjectsError ? (
          <Text style={styles.errorText}>{subjectsError}</Text>
        ) : subjects.length === 0 ? (
          <Text style={styles.emptyText}>No subjects enrolled yet.</Text>
        ) : (
          <View style={styles.grid}>
            {subjects.map((s) => {
              const counts   = subjectBadges[s.subject_id] ?? {};
              const pending  = assignments.pending.filter((a) => a.subject_id === s.subject_id).length;
              const hasItems = Object.keys(counts).length > 0;

              const badges =
                hasItems && pending === 0
                  ? [{ label: "✓ Tasks All Completed", count: 0 }]
                  : Object.entries(counts).map(([type, count]) => ({
                      label: `${capitalize(type)} ${count}`,
                      count,
                    }));

              return (
                <View key={s.subject_load_id} style={styles.gridItem}>
                  <SubjectCard
                    title={s.subject_name}
                    teacher={s.teacher_name}
                    badges={badges}
                    onPress={() =>
                      router.push({
                        pathname: "/student/subject-detail" as any,
                        params: {
                          subject_load_id: s.subject_load_id,
                          class_id:        s.class_id,
                          subject_id:      s.subject_id,
                          subject:         s.subject_name,
                          teacher:         s.teacher_name,
                          period:          s.period_name,
                          section:         s.section_name,
                        },
                      })
                    }
                  />
                </View>
              );
            })}
          </View>
        )}

        {/* ── To Do Section ────────────────────────────────────────── */}
        <View style={styles.todoCard}>
          <View style={styles.todoHeader}>
            <Text style={styles.todoTitle}>To do</Text>
            <TouchableOpacity
              onPress={() => router.push("/student/todo" as any)}
              style={styles.todoArrowBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-forward" size={16} color={AppColors.foreground} />
            </TouchableOpacity>
          </View>

          {assignmentsLoading ? (
            <ActivityIndicator size="small" color={AppColors.primary} style={{ marginTop: 12 }} />
          ) : todoItems.length === 0 ? (
            <Text style={styles.todoEmpty}>No pending tasks right now 🎉</Text>
          ) : (
            <View style={styles.todoList}>
              {todoItems.map((item) => {
                const { label, textColor, bgColor } = getDueDateInfo(item.due_date);
                return (
                  <TouchableOpacity
                    key={item.classwork_assignment_id}
                    style={styles.todoItem}
                    activeOpacity={0.8}
                    onPress={() =>
                      router.push({
                        pathname: "/student/classwork-view" as any,
                        params: { assignment_id: item.classwork_assignment_id },
                      })
                    }
                  >
                    <Text style={styles.todoItemTitle} numberOfLines={1}>
                      {item.classwork_title}
                    </Text>
                    <View style={[styles.dueBadge, { backgroundColor: bgColor }]}>
                      <Text style={[styles.dueText, { color: textColor }]}>{label}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: AppColors.background },
  content: { paddingHorizontal: Spacing.md, paddingBottom: 40, gap: 16 },

  sectionLabel: {
    fontSize: 11, fontWeight: "700", color: AppColors.mutedForeground,
    textTransform: "uppercase", letterSpacing: 1, marginTop: Spacing.md,
  },

  // 2-column grid
  grid:     { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  gridItem: { width: CARD_W },

  errorText: { fontSize: 14, color: AppColors.destructive, textAlign: "center", marginTop: 16 },
  emptyText: { fontSize: 14, color: AppColors.mutedForeground, textAlign: "center", marginTop: 16 },

  // To Do card
  todoCard: {
    borderWidth: 2, borderColor: AppColors.border, borderRadius: 10,
    padding: Spacing.md, backgroundColor: AppColors.card,
    ...NeoShadow.lg,
  },
  todoHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  todoTitle:  { fontSize: 18, fontWeight: "700", color: AppColors.foreground },
  todoArrowBtn: {
    borderWidth: 2, borderColor: AppColors.border,
    borderRadius: 999, padding: 6,
  },
  todoEmpty:  { marginTop: 10, fontSize: 13, color: AppColors.mutedForeground },
  todoList:   { marginTop: 12, gap: 8 },
  todoItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: AppColors.border, borderRadius: 8,
    backgroundColor: AppColors.background,
  },
  todoItemTitle: {
    flex: 1, fontSize: 13, fontWeight: "600",
    color: AppColors.foreground, marginRight: 8,
  },
  dueBadge:  { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  dueText:   { fontSize: 11, fontWeight: "700" },
});

export default StoryBoard;
