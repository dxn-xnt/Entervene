import React, { useCallback, useMemo, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useDrawer } from "@/context/DrawerContext";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/hooks/api";
import { AppColors, Spacing, Borders, NeoShadow } from "@/constants/theme";
import StatCard from "@/components/overview-card";
import type { TeacherLesson } from "@/hooks/useTeacherData";

const BANNER_BG = "#F6E9B2";
const ACTION_GREEN = "#7ABA78";
const TAG_GREEN_BG = "#dcfce7";
const TAG_GREEN_TEXT = "#166534";

type CwAssignmentRow = {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type: string;
  due_date: string | null;
  is_published: boolean;
};

type LinkedCw = {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type: string;
  due_date: string | null;
  attachment_count: number;
};

type LinkedCwCache = Record<number, LinkedCw[] | "loading">;

function cwTypeIcon(t: string): keyof typeof Ionicons.glyphMap {
  const u = (t || "").toUpperCase();
  if (u.includes("QUIZ") || u.includes("EXAM")) return "help-circle-outline";
  if (u.includes("ACTIVITY")) return "code-slash-outline";
  if (u.includes("ASSIGNMENT")) return "laptop-outline";
  return "document-text-outline";
}

function formatShortDate(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function TeacherSubjectDetail() {
  const { openDrawer } = useDrawer();
  const { session } = useAuth();
  const params = useLocalSearchParams<{
    subject?: string;
    title?: string;
    section?: string;
    class_id?: string;
    subject_id?: string;
    subject_load_id?: string;
  }>();

  const subjectName = params.subject ?? params.title ?? "Subject";
  const sectionName = params.section ?? "";
  const classId = Number(params.class_id);
  const subjectId = Number(params.subject_id);

  const [lessons, setLessons] = useState<TeacherLesson[]>([]);
  const [assignments, setAssignments] = useState<CwAssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lessonSearch, setLessonSearch] = useState("");
  const [cwSearch, setCwSearch] = useState("");
  const [lessonSort, setLessonSort] = useState<"newest" | "title" | "order">("newest");
  const [expandedLessonId, setExpandedLessonId] = useState<number | null>(null);
  const [linkedCwByLesson, setLinkedCwByLesson] = useState<LinkedCwCache>({});

  const validIds =
    Number.isFinite(classId) &&
    classId > 0 &&
    Number.isFinite(subjectId) &&
    subjectId > 0;

  const load = useCallback(async () => {
    if (!session?.token || !validIds) {
      setLoading(false);
      if (!validIds) setError("Missing class or subject. Open this screen from Classes.");
      return;
    }
    setError(null);
    try {
      const [lessonList, cwList] = await Promise.all([
        apiFetch<TeacherLesson[]>(
          `/api/v1/lessons/my-class/${classId}/subject/${subjectId}`,
          { token: session.token },
        ),
        apiFetch<CwAssignmentRow[]>(
          `/api/v1/classwork-assignments/teacher/class/${classId}/subject/${subjectId}/assignments`,
          { token: session.token },
        ),
      ]);
      setLessons(lessonList);
      setAssignments(cwList);
      setLinkedCwByLesson({});
      setExpandedLessonId(null);
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
      setLessons([]);
      setAssignments([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.token, classId, subjectId, validIds]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    void load();
  }, [load]));

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const openCreateLesson = () => {
    router.push({
      pathname: "/teacher/create-lesson" as any,
      params: {
        subject_load_id: params.subject_load_id,
        class_id: String(classId),
        subject_id: String(subjectId),
        subject: params.subject,
        section: params.section,
      },
    });
  };

  const openCreateClasswork = (lesson: TeacherLesson) => {
    router.push({
      pathname: "/teacher/create-classwork" as any,
      params: {
        subject_id: String(subjectId),
        class_id: String(classId),
        lesson_id: String(lesson.lesson_id),
        lesson_title: lesson.title,
      },
    });
  };

  const lessonMasteryPct =
    lessons.length === 0
      ? 0
      : Math.round(
        (lessons.filter((l) => l.is_published).length / lessons.length) * 100,
      );

  const cwPublishedPct =
    assignments.length === 0
      ? 0
      : Math.round(
        (assignments.filter((a) => a.is_published).length / assignments.length) *
        100,
      );

  const sectionSinceLabel = useMemo(() => {
    const dates = lessons
      .map((l) => l.created_at)
      .filter(Boolean) as string[];
    if (dates.length === 0) return "This academic year";
    const earliest = dates.reduce((a, b) => (a < b ? a : b));
    return `Section assigned since ${formatShortDate(earliest)}`;
  }, [lessons]);

  const filteredSortedLessons = useMemo(() => {
    const q = lessonSearch.trim().toLowerCase();
    let list = q
      ? lessons.filter((l) => l.title.toLowerCase().includes(q))
      : [...lessons];
    if (lessonSort === "title") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (lessonSort === "order") {
      list.sort((a, b) => a.order_index - b.order_index || (a.lesson_id - b.lesson_id));
    } else {
      list.sort((a, b) => {
        const da = new Date(a.created_at || 0).getTime();
        const db = new Date(b.created_at || 0).getTime();
        return db - da;
      });
    }
    return list;
  }, [lessons, lessonSearch, lessonSort]);

  const filteredSortedCw = useMemo(() => {
    const q = cwSearch.trim().toLowerCase();
    let list = q
      ? assignments.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.classwork_type.toLowerCase().includes(q),
      )
      : [...assignments];
    list.sort((a, b) => {
      const da = a.due_date ? new Date(a.due_date).getTime() : 0;
      const db = b.due_date ? new Date(b.due_date).getTime() : 0;
      return db - da;
    });
    return list;
  }, [assignments, cwSearch]);

  const loadLinkedForLesson = async (lessonId: number) => {
    if (!session?.token || !validIds) return;
    setLinkedCwByLesson((prev) => ({ ...prev, [lessonId]: "loading" }));
    try {
      const rows = await apiFetch<LinkedCw[]>(
        `/api/v1/lessons/my-class/${classId}/lesson/${lessonId}/linked-classwork`,
        { token: session.token },
      );
      setLinkedCwByLesson((prev) => ({ ...prev, [lessonId]: rows }));
    } catch {
      setLinkedCwByLesson((prev) => ({ ...prev, [lessonId]: [] }));
    }
  };

  const toggleLessonExpand = (lessonId: number) => {
    if (expandedLessonId === lessonId) {
      setExpandedLessonId(null);
      return;
    }
    setExpandedLessonId(lessonId);
    const cached = linkedCwByLesson[lessonId];
    if (cached === undefined) void loadLinkedForLesson(lessonId);
  };

  const cycleLessonSort = () => {
    setLessonSort((s) =>
      s === "newest" ? "title" : s === "title" ? "order" : "newest",
    );
  };

  const lessonSortLabel =
    lessonSort === "newest"
      ? "Newest"
      : lessonSort === "title"
        ? "Title A–Z"
        : "Lesson order";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Top bar — matches web: nav + breadcrumb row + primary action */}
      <View style={styles.topBar}>
        <View style={styles.topBarRow}>
          <TouchableOpacity onPress={openDrawer} activeOpacity={0.7} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginHorizontal: 8 }}>
            <TouchableOpacity
              onPress={() => router.back()}
              activeOpacity={0.7}
              style={styles.breadcrumbWrap}
            >
              <Text style={styles.backText}>Subjects</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.addLessonBtn}
            onPress={openCreateLesson}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={20} color={AppColors.foreground} />
            <Text style={styles.addLessonBtnText}>Add Lesson</Text>
          </TouchableOpacity>
        </View>

        {/* Tabs — web-style with icons */}
        <View style={styles.tabRow}>
          <View style={[styles.tabItem, styles.tabItemActive]}>
            <Ionicons
              name="book-outline"
              size={18}
              color={AppColors.foreground}
            />
            <Text
              style={[
                styles.tabLabel,
                styles.tabLabelActive,
              ]}
            >
              Lessons
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.tabItem, styles.hiddenTab]}
            onPress={() => { }}
            activeOpacity={0.8}
          >
            <Ionicons
              name="clipboard-outline"
              size={18}
              color={AppColors.mutedForeground}
            />
            <Text
              style={[
                styles.tabLabel,
              ]}
            >
              Classwork
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 40 }} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <>
            {/* Subject banner (web reference) */}
            <View style={styles.subjectBanner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>{subjectName}</Text>
                <Text style={styles.bannerSub}>
                  {sectionName ? `${sectionName} · ` : ""}
                  {sectionSinceLabel}
                </Text>
              </View>
              <Ionicons
                name="information-circle-outline"
                size={22}
                color={AppColors.mutedForeground}
              />
            </View>

            {/* Original overview metric cards (StatCard + trend line) */}
            {/* <Text style={styles.sectionHeading}>Subject Overview</Text>
            <View style={styles.overviewGrid}>
              <StatCard
                label="Lesson Mastery"
                value={lessonMasteryPct}
                unit="%"
                change="12"
              />
              <StatCard
                label="Classwork Assigned"
                value={assignments.length}
                unit=""
                change="12"
              />
              <StatCard
                label="Completion Percentage"
                value={cwPublishedPct}
                unit="%"
                change="12"
              />
            </View>
            */}

            {true && (
              <View style={styles.panel}>
                <View style={styles.searchRow}>
                  <View style={styles.searchField}>
                    <Ionicons name="search-outline" size={18} color={AppColors.mutedForeground} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Search lessons"
                      placeholderTextColor={AppColors.placeholder}
                      value={lessonSearch}
                      onChangeText={setLessonSearch}
                    />
                  </View>
                  <TouchableOpacity style={styles.sortChip} onPress={cycleLessonSort}>
                    <Text style={styles.sortChipText}>Sort: {lessonSortLabel}</Text>
                    <Ionicons name="chevron-down" size={14} color={AppColors.foreground} />
                  </TouchableOpacity>
                </View>

                {filteredSortedLessons.length === 0 ? (
                  <Text style={styles.empty}>No lessons yet. Tap Add Lesson to create one.</Text>
                ) : (
                  filteredSortedLessons.map((l) => {
                    const expanded = expandedLessonId === l.lesson_id;
                    const linked = linkedCwByLesson[l.lesson_id];
                    return (
                      <View key={l.lesson_id} style={styles.lessonCard}>
                        <TouchableOpacity
                          style={styles.lessonCardHeader}
                          onPress={() => toggleLessonExpand(l.lesson_id)}
                          activeOpacity={0.85}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.lessonTitle}>{l.title}</Text>
                            <Text style={styles.lessonMeta}>
                              {l.is_published ? "Published" : "Draft"}
                              {l.created_at
                                ? ` · Created ${formatShortDate(l.created_at)}`
                                : ""}
                            </Text>
                          </View>
                          <Ionicons
                            name={expanded ? "chevron-down" : "chevron-forward"}
                            size={22}
                            color={AppColors.foreground}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.lessonOpenDetail}
                          onPress={() =>
                            router.push({
                              pathname: "/teacher/lesson-detail" as any,
                              params: {
                                lesson_id: String(l.lesson_id),
                                subject_load_id: params.subject_load_id,
                                class_id: String(classId),
                                subject_id: String(subjectId),
                                subject: params.subject,
                                section: params.section
                              },
                            })
                          }
                        >
                          <Text style={styles.lessonOpenDetailText}>Open lesson detail</Text>
                          <Ionicons name="open-outline" size={16} color={AppColors.mutedForeground} />
                        </TouchableOpacity>

                        {expanded && (
                          <View style={styles.nestedBlock}>
                            <TouchableOpacity
                              style={styles.addClassworkInsideLesson}
                              onPress={() => openCreateClasswork(l)}
                              activeOpacity={0.85}
                            >
                              <Ionicons name="add-circle-outline" size={18} color={AppColors.foreground} />
                              <Text style={styles.addClassworkInsideLessonText}>Add classwork to this lesson</Text>
                            </TouchableOpacity>
                            {linked === "loading" ? (
                              <ActivityIndicator size="small" color={AppColors.primary} />
                            ) : linked && linked.length > 0 ? (
                              linked.map((cw) => (
                                <TouchableOpacity
                                  key={cw.classwork_assignment_id}
                                  style={styles.nestedCwCard}
                                  onPress={() =>
                                    router.push({
                                      pathname: "/teacher/classwork-detail" as any,
                                      params: { classwork_id: String(cw.classwork_id) },
                                    })
                                  }
                                  activeOpacity={0.85}
                                >
                                  <Ionicons
                                    name={cwTypeIcon(cw.classwork_type)}
                                    size={18}
                                    color={AppColors.foreground}
                                  />
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.nestedCwTitle}>{cw.title}</Text>
                                    <Text style={styles.nestedCwMeta}>
                                      {cw.classwork_type}
                                      {cw.due_date
                                        ? ` · Due ${formatShortDate(cw.due_date)}`
                                        : ""}
                                    </Text>
                                  </View>
                                  {cw.attachment_count > 0 ? (
                                    <View style={styles.fileTag}>
                                      <Text style={styles.fileTagText}>
                                        File {cw.attachment_count}
                                      </Text>
                                    </View>
                                  ) : null}
                                </TouchableOpacity>
                              ))
                            ) : (
                              <Text style={styles.nestedEmpty}>
                                No classwork linked to this lesson for this section.
                              </Text>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            )}

            {false && (
              <View style={styles.panel}>
                <View style={styles.searchRow}>
                  <View style={styles.searchField}>
                    <Ionicons name="search-outline" size={18} color={AppColors.mutedForeground} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Search classwork"
                      placeholderTextColor={AppColors.placeholder}
                      value={cwSearch}
                      onChangeText={setCwSearch}
                    />
                  </View>
                </View>

                {filteredSortedCw.length === 0 ? (
                  <Text style={styles.empty}>
                    No classwork for this section yet. Tap Assign to add one.
                  </Text>
                ) : (
                  filteredSortedCw.map((a) => (
                    <TouchableOpacity
                      key={a.classwork_assignment_id}
                      style={styles.cwRowCard}
                      activeOpacity={0.85}
                      onPress={() =>
                        router.push({
                          pathname: "/teacher/classwork-detail" as any,
                          params: { classwork_id: String(a.classwork_id) },
                        })
                      }
                    >
                      <View style={styles.cwIconCircle}>
                        <Ionicons
                          name={cwTypeIcon(a.classwork_type)}
                          size={20}
                          color={AppColors.foreground}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cwTitle}>{a.title}</Text>
                        <Text style={styles.cwMeta}>
                          {a.is_published ? "Published" : "Draft"}
                          {a.due_date ? ` · Due ${formatShortDate(a.due_date)}` : ""}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.submissionsBtn}
                        onPress={() =>
                          router.push({
                            pathname: "/teacher/submissions" as any,
                            params: {
                              assignment_id: String(a.classwork_assignment_id),
                              classwork_title: a.title,
                            },
                          })
                        }
                        activeOpacity={0.85}
                      >
                        <Ionicons name="people-outline" size={16} color={AppColors.foreground} />
                        <Text style={styles.submissionsBtnText}>Status</Text>
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  topBar: {
    paddingBottom: Spacing.sm,
  },
  backText: { fontSize: 22, fontWeight: '700', color: AppColors.foreground },
  topBarRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingTop: 10,
    gap: 4,
  },
  breadcrumbWrap: { flexDirection: "row", alignItems: "center", flexWrap: "nowrap" },
  breadcrumbMuted: { fontSize: 13, color: AppColors.mutedForeground, fontWeight: "600" },
  breadcrumbChevron: { fontSize: 13, color: AppColors.mutedForeground },
  breadcrumbActive: { fontSize: 13, fontWeight: "800", color: AppColors.foreground, flex: 1 },
  addLessonBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: ACTION_GREEN,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 8,
    ...NeoShadow.sm,
  },
  addLessonBtnText: { fontSize: 12, fontWeight: "800", color: AppColors.foreground },
  tabRow: {
    flexDirection: "row",
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
    borderBottomWidth: Borders.width,
    borderBottomColor: AppColors.border,
  },
  tabItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  tabItemActive: { borderBottomColor: AppColors.foreground },
  hiddenTab: { display: "none" },
  tabLabel: { fontSize: 14, fontWeight: "600", color: AppColors.mutedForeground },
  tabLabelActive: { color: AppColors.foreground, fontWeight: "800" },
  scrollContent: { padding: Spacing.md, paddingBottom: 48, gap: Spacing.md },
  subjectBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: BANNER_BG,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 10,
    padding: Spacing.md,
    gap: 12,
    ...NeoShadow.md,
  },
  bannerTitle: { fontSize: 22, fontWeight: "900", color: AppColors.foreground },
  bannerSub: { fontSize: 13, color: AppColors.mutedForeground, marginTop: 6, lineHeight: 18 },
  sectionHeading: {
    fontSize: 16,
    fontWeight: "800",
    color: AppColors.foreground,
    marginTop: 4,
  },
  overviewGrid: { gap: 12 },
  panel: { gap: 12 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: AppColors.card,
    ...NeoShadow.xs,
  },
  searchInput: { flex: 1, fontSize: 14, color: AppColors.foreground, paddingVertical: 2 },
  sortChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: AppColors.card,
  },
  sortChipText: { fontSize: 12, fontWeight: "700", color: AppColors.foreground },
  lessonCard: {
    backgroundColor: BANNER_BG,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 10,
    overflow: "hidden",
    ...NeoShadow.sm,
  },
  lessonCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 10,
  },
  lessonTitle: { fontSize: 16, fontWeight: "800", color: AppColors.foreground },
  lessonMeta: { fontSize: 12, color: AppColors.mutedForeground, marginTop: 4 },
  lessonOpenDetail: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderTopWidth: Borders.width,
    borderTopColor: AppColors.border,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  lessonOpenDetailText: { fontSize: 12, fontWeight: "700", color: AppColors.mutedForeground },
  nestedBlock: {
    paddingHorizontal: 10,
    paddingBottom: 12,
    paddingTop: 4,
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  addClassworkInsideLesson: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: ACTION_GREEN,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    ...NeoShadow.xs,
  },
  addClassworkInsideLessonText: { fontSize: 13, fontWeight: "900", color: AppColors.foreground },
  nestedCwCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: AppColors.white,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 8,
    padding: 12,
    ...NeoShadow.xs,
  },
  nestedCwTitle: { fontSize: 14, fontWeight: "800", color: AppColors.foreground },
  nestedCwMeta: { fontSize: 11, color: AppColors.mutedForeground, marginTop: 2 },
  nestedEmpty: { fontSize: 12, color: AppColors.mutedForeground, paddingHorizontal: 8 },
  fileTag: {
    backgroundColor: TAG_GREEN_BG,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: TAG_GREEN_TEXT,
  },
  fileTagText: { fontSize: 11, fontWeight: "800", color: TAG_GREEN_TEXT },
  cwRowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: AppColors.white,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 10,
    padding: 14,
    ...NeoShadow.sm,
  },
  cwIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.muted,
  },
  cwTitle: { fontSize: 15, fontWeight: "800", color: AppColors.foreground },
  cwMeta: { fontSize: 12, color: AppColors.mutedForeground, marginTop: 4 },
  submissionsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 8,
    backgroundColor: ACTION_GREEN,
  },
  submissionsBtnText: { fontSize: 11, fontWeight: "900", color: AppColors.foreground },
  empty: { fontSize: 14, color: AppColors.mutedForeground, paddingVertical: 12 },
  errorText: { fontSize: 14, color: AppColors.destructive, paddingVertical: 12 },
});
