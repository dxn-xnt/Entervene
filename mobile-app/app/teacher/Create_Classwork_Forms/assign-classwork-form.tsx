import React, { useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  FlatList,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/context/AuthContext";
import { useTeacherClasses, TeacherClassSubject } from "@/hooks/useTeacherData";
import { apiFetch } from "@/hooks/api";
import { ClassworkUi } from "@/constants/classwork-ui";

import ClassworkModalShell from "@/components/teacher/classwork-modal-shell";
import FormFooter from "@/components/teacher/form-footer";
import FormDropdown from "@/components/teacher/form-dropdown";
import DatePickerField from "@/components/teacher/date-picker-field";

const PUBLISH_MODE = [
  { label: "During class period", value: "now" },
  { label: "Schedule availability", value: "scheduled" },
];

function sectionGradeLabel(sectionName: string): string | null {
  const m = /^(\d+)\b/.exec(sectionName.trim());
  return m ? `Grade ${m[1]}` : null;
}

const ASSIGN_TITLE: Record<string, string> = {
  reading: "Assign reading material",
  quiz: "Assign quiz",
  assignment: "Assign assignment",
  activity: "Assign activity",
};

export default function TeacherAssignClasswork() {
  const params = useLocalSearchParams<{
    classworkId?: string;
    subjectId?: string;
    kind?: string;
  }>();
  const classworkId = Number(params.classworkId);
  const subjectId = Number(params.subjectId);
  const kind = params.kind ?? "";

  const { session } = useAuth();
  const { classes } = useTeacherClasses();

  const [publishMode, setPublishMode] = useState("now");
  const [publishDate, setPublishDate] = useState<Date | null>(null);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [lockDate, setLockDate] = useState<Date | null>(null);
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [gradeFilters, setGradeFilters] = useState<string[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>([]);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const subjectClasses = useMemo(() => {
    if (!Number.isFinite(subjectId)) return [] as TeacherClassSubject[];
    return classes.filter((c) => c.subject_id === subjectId);
  }, [classes, subjectId]);

  const availableGrades = useMemo(() => {
    const set = new Set<string>();
    for (const c of subjectClasses) {
      const g = sectionGradeLabel(c.section_name);
      if (g) set.add(g);
    }
    return [...set].sort();
  }, [subjectClasses]);

  const gradeOptionsForModal = useMemo(
    () => availableGrades.filter((g) => !gradeFilters.includes(g)),
    [availableGrades, gradeFilters],
  );

  const classMatchesFilters = (c: TeacherClassSubject) => {
    if (!gradeFilters.length) return true;
    const g = sectionGradeLabel(c.section_name);
    return g ? gradeFilters.includes(g) : false;
  };

  const toggleClass = (id: number) => {
    setSelectedClassIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const addGradeFilter = (g: string) => {
    if (!gradeFilters.includes(g)) setGradeFilters((p) => [...p, g]);
    setFilterModalOpen(false);
  };

  const removeGradeFilter = (g: string) => {
    setGradeFilters((p) => p.filter((x) => x !== g));
  };

  const handleAssign = async () => {
    if (!session?.token) {
      Alert.alert("Session", "Please sign in again.");
      return;
    }
    if (!Number.isFinite(classworkId) || classworkId <= 0) {
      Alert.alert("Missing classwork", "Go back and complete the previous step.");
      return;
    }
    if (!selectedClassIds.length) {
      Alert.alert("Classes", "Select at least one class section.");
      return;
    }
    if (publishMode === "scheduled" && !publishDate) {
      Alert.alert("Publish date", "Pick when this becomes available.");
      return;
    }

    const publishIso =
      publishMode === "now"
        ? new Date().toISOString()
        : publishDate
          ? publishDate.toISOString()
          : new Date().toISOString();

    setSaving(true);
    try {
      await apiFetch(
        `/api/v1/classwork-assignments/classwork/${classworkId}/assign`,
        {
          method: "POST",
          token: session.token,
          body: JSON.stringify({
            class_ids: selectedClassIds,
            publish_date: publishIso,
            due_date: dueDate ? dueDate.toISOString() : null,
            lock_date: lockDate ? lockDate.toISOString() : null,
            max_attempts: parseInt(maxAttempts, 10) || 1,
            is_published: true,
          }),
        },
      );
      Alert.alert("Assigned", "Students in the selected sections can now see this classwork.");
      router.replace("/teacher/classworks");
    } catch (e: any) {
      Alert.alert("Could not assign", e.message ?? "Request failed");
    } finally {
      setSaving(false);
    }
  };

  const headerTitle = ASSIGN_TITLE[kind] ?? "Assign classwork";

  if (!Number.isFinite(subjectId) || subjectId <= 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.pageWrap}>
          <Text style={styles.err}>Missing subject. Use the classwork wizard from the start.</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.link}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.pageWrap}>
        <ClassworkModalShell
          title={headerTitle}
          onClose={() => router.back()}
          footer={
            <FormFooter
              actions={[
                {
                  label: saving ? "Assigning…" : "Assign",
                  onPress: () => {
                    if (!saving) void handleAssign();
                  },
                },
              ]}
            />
          }
        >
          <ScrollView
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Labeled label="Upload time">
              <FormDropdown
                options={PUBLISH_MODE}
                value={publishMode}
                onChange={setPublishMode}
                placeholder="When students can see this"
              />
            </Labeled>
            {publishMode === "scheduled" ? (
              <DatePickerField
                label="Available from"
                value={publishDate}
                onChange={setPublishDate}
                minimumDate={new Date()}
              />
            ) : null}

            <DatePickerField
              label="Due date (optional)"
              value={dueDate}
              onChange={setDueDate}
              minimumDate={publishDate ?? new Date()}
            />

            <DatePickerField
              label="Lock date (optional)"
              value={lockDate}
              onChange={setLockDate}
              minimumDate={dueDate ?? publishDate ?? new Date()}
            />

            <Labeled label="Max attempts">
              <TextInput
                style={styles.input}
                value={maxAttempts}
                onChangeText={setMaxAttempts}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor="#999"
              />
            </Labeled>

            <View style={styles.assignHeader}>
              <Text style={styles.assignTitle}>Assign to</Text>
              <View style={styles.filterRow}>
                {gradeFilters.map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={styles.filterChip}
                    onPress={() => removeGradeFilter(g)}
                  >
                    <Text style={styles.filterChipX}>✕</Text>
                    <Text style={styles.filterChipText}>{g}</Text>
                  </TouchableOpacity>
                ))}
                {gradeOptionsForModal.length > 0 ? (
                  <TouchableOpacity
                    style={styles.addFilterBtn}
                    onPress={() => setFilterModalOpen(true)}
                  >
                    <Ionicons name="funnel-outline" size={16} color={ClassworkUi.title} />
                    <Text style={styles.addFilterText}>Add filter</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            <View style={styles.classGrid}>
              {subjectClasses.map((c) => {
                const enabled = classMatchesFilters(c);
                const selected = selectedClassIds.includes(c.class_id);
                return (
                  <TouchableOpacity
                    key={c.class_id}
                    disabled={!enabled}
                    onPress={() => enabled && toggleClass(c.class_id)}
                    style={[
                      styles.classChip,
                      selected && styles.classChipOn,
                      !enabled && styles.classChipDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.classChipText,
                        !enabled && styles.classChipTextDisabled,
                      ]}
                    >
                      {c.section_name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {!subjectClasses.length ? (
              <Text style={styles.hint}>
                No class sections are linked to this subject for your account.
              </Text>
            ) : null}

            {saving ? (
              <View style={styles.busy}>
                <ActivityIndicator color={ClassworkUi.title} />
              </View>
            ) : null}
          </ScrollView>
        </ClassworkModalShell>
      </View>

      <Modal visible={filterModalOpen} transparent animationType="fade">
        <View style={styles.modalRoot}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setFilterModalOpen(false)}
          />
          <View
            pointerEvents="box-none"
            style={[StyleSheet.absoluteFillObject, styles.modalCenter]}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Filter by grade</Text>
              <FlatList
                data={gradeOptionsForModal}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalRow}
                    onPress={() => addGradeFilter(item)}
                  >
                    <Text style={styles.modalRowText}>{item}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.modalEmpty}>All grades are already filtered.</Text>
                }
              />
              <TouchableOpacity
                style={styles.modalDone}
                onPress={() => setFilterModalOpen(false)}
              >
                <Text style={styles.modalDoneText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ClassworkUi.bodyBg },
  pageWrap: { flex: 1, padding: 16, justifyContent: "center" },
  form: { padding: 16, gap: 16, paddingBottom: 32 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: ClassworkUi.title },
  input: {
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: "#fff",
  },
  assignHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 4,
  },
  assignTitle: { fontSize: 14, fontWeight: "700", color: ClassworkUi.title },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
    flex: 1,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    backgroundColor: ClassworkUi.chipMuted,
  },
  filterChipX: { fontSize: 12, fontWeight: "800" },
  filterChipText: { fontSize: 12, fontWeight: "600" },
  addFilterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    backgroundColor: "#fff",
  },
  addFilterText: { fontSize: 12, fontWeight: "600" },
  classGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "flex-start",
  },
  classChip: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    backgroundColor: ClassworkUi.chipMuted,
  },
  classChipOn: {
    backgroundColor: ClassworkUi.chipSelected,
  },
  classChipDisabled: {
    opacity: 0.45,
  },
  classChipText: { fontSize: 13, fontWeight: "700", color: ClassworkUi.title },
  classChipTextDisabled: { color: "#666" },
  hint: { fontSize: 13, color: "#555" },
  busy: { paddingVertical: 16, alignItems: "center" },
  err: { fontSize: 15, marginBottom: 12 },
  link: { fontSize: 16, color: "#1565C0", fontWeight: "700" },
  modalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  modalCenter: { justifyContent: "center", padding: 20 },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    maxHeight: "70%",
    overflow: "hidden",
  },
  modalTitle: {
    fontWeight: "700",
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  modalRowText: { fontSize: 15 },
  modalEmpty: { padding: 16, color: "#666" },
  modalDone: {
    padding: 14,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  modalDoneText: { fontWeight: "700", fontSize: 16 },
});
