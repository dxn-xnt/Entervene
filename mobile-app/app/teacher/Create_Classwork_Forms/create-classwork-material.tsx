import React, { useMemo, useState, useEffect } from "react";
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
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/context/AuthContext";
import {
  useTeacherClasses,
  useTeacherLessons,
  TeacherLesson,
} from "@/hooks/useTeacherData";
import { apiFetch, apiUploadSingle, UploadableFile } from "@/hooks/api";
import { ClassworkUi } from "@/constants/classwork-ui";

import ClassworkModalShell from "@/components/teacher/classwork-modal-shell";
import FormFooter from "@/components/teacher/form-footer";
import FormDropdown from "@/components/teacher/form-dropdown";
import AddButton from "@/components/teacher/add-button-form";
import MaterialCard from "@/components/teacher/material-card";

type ClassworkType = "reading" | "quiz" | "assignment" | "activity";

const MAX_FILE_SIZE = 4 * 1024 * 1024;

const CATEGORY_OPTIONS = [
  { label: "Written Works", value: "WRITTEN_WORK" },
  { label: "Performance Task", value: "PERFORMANCE_TASK" },
  { label: "Quarterly Assessment", value: "PERIODICAL_EXAM" },
];

const QUESTION_TYPES = [
  "Identification",
  "True or False",
  "Multiple Choices",
];

const SUBMISSION_TYPES = [
  { id: "image", label: "Image (png, jpeg)" },
  { id: "document", label: "Document (pdf, docs)" },
  { id: "other", label: "Other (pptx, xlsx)" },
];

const RUBRIC_LEVELS = [
  {
    label: "Excellent",
    pts: 10,
    desc: "Displays all required components clearly and accurately.",
  },
  {
    label: "Good",
    pts: 8,
    desc: "Most components are present with minor errors.",
  },
  {
    label: "Fair",
    pts: 6,
    desc: "Some required parts are missing or unclear.",
  },
  {
    label: "Needs Improvement",
    pts: 4,
    desc: "Many required elements are missing.",
  },
  { label: "Poor", pts: 2, desc: "Work is incomplete or not submitted." },
];

const SCREEN_TITLE: Record<ClassworkType, string> = {
  reading: "Create reading material",
  quiz: "Create quiz from lessons",
  assignment: "Create assignment",
  activity: "Create activity from lessons",
};

function backendClassworkType(t: ClassworkType): string {
  if (t === "reading" || t === "assignment") return "ASSIGNMENT";
  if (t === "quiz") return "QUIZ";
  return "ACTIVITY";
}

function fileKindLabel(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "Docx";
  if (lower.endsWith(".pptx")) return "Pptx";
  if (lower.endsWith(".pdf")) return "Pdf";
  if (lower.endsWith(".xlsx")) return "Xlsx";
  if (lower.endsWith(".png") || lower.endsWith(".jpeg") || lower.endsWith(".jpg"))
    return "Image";
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toUpperCase().slice(0, 4) : "File";
}

function formatRubricInstructions() {
  return (
    "Activity rubric (reference):\n" +
    RUBRIC_LEVELS.map((r) => `${r.label} (${r.pts} pts): ${r.desc}`).join("\n")
  );
}

function ActivityRubric() {
  return (
    <View style={rubricStyles.wrapper}>
      <Text style={rubricStyles.title}>Activity Rubric</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={rubricStyles.row}>
          {RUBRIC_LEVELS.map((level) => (
            <View key={level.label} style={rubricStyles.cell}>
              <View style={rubricStyles.cellHeader}>
                <Text style={rubricStyles.levelLabel}>{level.label}</Text>
                <Text style={rubricStyles.pts}>{level.pts} pts</Text>
              </View>
              <Text style={rubricStyles.desc}>{level.desc}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export default function CreateClassworkForm() {
  const { type } = useLocalSearchParams<{ type: ClassworkType }>();
  const classworkType: ClassworkType = type ?? "reading";
  const { session } = useAuth();
  const { classes } = useTeacherClasses();
  const { lessons, isLoading: lessonsLoading } = useTeacherLessons();

  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [lessonId, setLessonId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [quizDurationMin, setQuizDurationMin] = useState("");
  const [selectedLessonIds, setSelectedLessonIds] = useState<number[]>([]);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<string[]>(
    [...QUESTION_TYPES],
  );
  const [submissionIds, setSubmissionIds] = useState<string[]>([]);
  const [files, setFiles] = useState<UploadableFile[]>([]);
  const [lessonPickerOpen, setLessonPickerOpen] = useState(false);
  const [qtPickerOpen, setQtPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const subjectOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of classes) {
      if (!map.has(c.subject_id)) map.set(c.subject_id, c.subject_name);
    }
    return [...map.entries()].map(([value, label]) => ({
      label,
      value: String(value),
    }));
  }, [classes]);

  const lessonsForSubject = useMemo(() => {
    if (!subjectId) return [] as TeacherLesson[];
    return lessons.filter((l) => l.subject_id === subjectId);
  }, [lessons, subjectId]);

  useEffect(() => {
    setLessonId(null);
    setSelectedLessonIds([]);
  }, [subjectId]);

  const lessonOptions = useMemo(
    () =>
      lessonsForSubject.map((l) => ({
        label: l.title,
        value: String(l.lesson_id),
      })),
    [lessonsForSubject],
  );

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "image/jpeg",
        "image/png",
      ],
      multiple: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const picked = result.assets.map((a) => ({
      uri: a.uri,
      name: a.name,
      type: a.mimeType || "application/octet-stream",
      size: a.size ?? 0,
      webFile: (a as { file?: Blob }).file,
    }));
    const oversized = picked.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length) {
      Alert.alert(
        "File too large",
        `These files exceed 4MB: ${oversized.map((f) => f.name).join(", ")}`,
      );
      return;
    }
    setFiles((prev) => [...prev, ...picked.map(({ size: _s, ...f }) => f)]);
  };

  const toggleLesson = (id: number) => {
    setSelectedLessonIds((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id],
    );
  };

  const toggleQuestionType = (q: string) => {
    setSelectedQuestionTypes((p) =>
      p.includes(q) ? p.filter((x) => x !== q) : [...p, q],
    );
  };

  const toggleSubmission = (id: string) => {
    setSubmissionIds((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id],
    );
  };

  const buildPayload = () => {
    if (!subjectId) throw new Error("Select a subject");
    const lesson = lessonId
      ? lessonsForSubject.find((l) => l.lesson_id === lessonId)
      : null;
    const selectedLessons = lessonsForSubject.filter((l) =>
      selectedLessonIds.includes(l.lesson_id),
    );

    let desc = description.trim();
    let instr = "";

    if (classworkType === "reading") {
      const t = title.trim();
      if (!t) throw new Error("Topic title is required");
      if (!lesson) throw new Error("Select a lesson");
      desc = [desc, `Related lesson: ${lesson.title} (#${lesson.lesson_id})`]
        .filter(Boolean)
        .join("\n\n");
      return {
        title: t,
        description: desc || null,
        instructions: "Reading material",
        classwork_category: category || null,
      };
    }

    if (classworkType === "assignment") {
      const t = title.trim();
      if (!t) throw new Error("Topic title is required");
      if (!category) throw new Error("Select a grading component");
      instr = [formatRubricInstructions()].filter(Boolean).join("\n\n");
      return {
        title: t,
        description: desc || null,
        instructions: instr || null,
        classwork_category: category || null,
      };
    }

    if (classworkType === "quiz") {
      const t = title.trim();
      if (!t) throw new Error("Quiz title is required");
      if (!category) throw new Error("Select a classwork category");
      if (!selectedLessons.length)
        throw new Error("Select at least one lesson");
      const dur = quizDurationMin.trim();
      instr = [
        `Question types: ${selectedQuestionTypes.join(", ") || "—"}`,
        dur ? `Suggested duration (minutes): ${dur}` : null,
        `Source lessons: ${selectedLessons.map((l) => `${l.title} (#${l.lesson_id})`).join("; ")}`,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        title: t,
        description: desc || null,
        instructions: instr,
        classwork_category: category,
      };
    }

    /* activity */
    const t = title.trim();
    if (!t) throw new Error("Activity title is required");
    if (!category) throw new Error("Select a classwork category");
    if (!lesson) throw new Error("Select a lesson");
    const allow = SUBMISSION_TYPES.filter((s) => submissionIds.includes(s.id))
      .map((s) => s.label)
      .join(", ");
    instr = [
      `Primary lesson: ${lesson.title} (#${lesson.lesson_id})`,
      allow ? `Accepted submissions: ${allow}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      title: t,
      description: desc || null,
      instructions: instr,
      classwork_category: category,
    };
  };

  const handlePrimary = async () => {
    if (!session?.token) {
      Alert.alert("Session", "Please sign in again.");
      return;
    }
    let payload: {
      title: string;
      description: string | null;
      instructions: string | null;
      classwork_category: string | null;
    };
    try {
      payload = buildPayload();
    } catch (e: any) {
      Alert.alert("Missing information", e.message || "Check the form");
      return;
    }

    setSaving(true);
    try {
      const cw = await apiFetch<{ classwork_id: number }>(
        "/api/v1/classwork-assignments/",
        {
          method: "POST",
          token: session.token,
          body: JSON.stringify({
            title: payload.title,
            description: payload.description,
            instructions: payload.instructions,
            classwork_type: backendClassworkType(classworkType),
            classwork_category: payload.classwork_category,
            total_points: 100,
            subject_id: subjectId,
            is_published: false,
          }),
        },
      );

      for (const f of files) {
        await apiUploadSingle(
          `/api/v1/classwork-assignments/classwork/${cw.classwork_id}/attachments`,
          f,
          session.token,
        );
      }

      router.push({
        pathname: "/teacher/Create_Classwork_Forms/assign-classwork-form",
        params: {
          classworkId: String(cw.classwork_id),
          subjectId: String(subjectId),
          kind: classworkType,
        },
      });
    } catch (e: any) {
      Alert.alert("Could not save", e.message ?? "Request failed");
    } finally {
      setSaving(false);
    }
  };

  const primaryLabel =
    classworkType === "quiz" || classworkType === "activity"
      ? "Generate"
      : "Next";

  const renderReading = () => (
    <>
      <Labeled label="Topic title">
        <TextInput
          style={styles.textInput}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Introduction to Programming Reading Materials"
          placeholderTextColor="#999"
        />
      </Labeled>
      <Labeled label="Subject">
        <FormDropdown
          options={subjectOptions}
          value={subjectId != null ? String(subjectId) : ""}
          onChange={(v) => setSubjectId(v ? Number(v) : null)}
          placeholder="Select subject"
        />
      </Labeled>
      <Labeled label="Lesson">
        <FormDropdown
          options={lessonOptions}
          value={lessonId != null ? String(lessonId) : ""}
          onChange={(v) => setLessonId(v ? Number(v) : null)}
          placeholder={
            subjectId ? (lessonsLoading ? "Loading…" : "Select lesson") : "Pick a subject first"
          }
        />
      </Labeled>
      <UploadRow files={files} onAdd={pickFiles} onRemove={(i) => setFiles((p) => p.filter((_, idx) => idx !== i))} />
    </>
  );

  const renderAssignment = () => (
    <>
      <Labeled label="Subject">
        <FormDropdown
          options={subjectOptions}
          value={subjectId != null ? String(subjectId) : ""}
          onChange={(v) => setSubjectId(v ? Number(v) : null)}
          placeholder="Select subject"
        />
      </Labeled>
      <Labeled label="Topic title">
        <TextInput
          style={styles.textInput}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Introduction to Programming Reading Materials"
          placeholderTextColor="#999"
        />
      </Labeled>
      <Labeled label="Description">
        <TextInput
          style={[styles.textInput, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Answer the following in one whole sheet of paper."
          placeholderTextColor="#999"
          multiline
        />
      </Labeled>
      <UploadRow files={files} onAdd={pickFiles} onRemove={(i) => setFiles((p) => p.filter((_, idx) => idx !== i))} />
      <Labeled label="Grading Component">
        <FormDropdown
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={setCategory}
          placeholder="Select grading component"
        />
      </Labeled>
      <Labeled label="Rubrics">
        <ActivityRubric />
      </Labeled>
    </>
  );

  const renderQuiz = () => (
    <>
      <Labeled label="Classwork Category">
        <FormDropdown
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={setCategory}
          placeholder="Select category"
        />
      </Labeled>
      <Labeled label="Subject">
        <FormDropdown
          options={subjectOptions}
          value={subjectId != null ? String(subjectId) : ""}
          onChange={(v) => setSubjectId(v ? Number(v) : null)}
          placeholder="Select subject"
        />
      </Labeled>
      <Labeled label="Lessons">
        <View style={styles.chipRow}>
          {selectedLessonIds.map((id) => {
            const l = lessonsForSubject.find((x) => x.lesson_id === id);
            if (!l) return null;
            return (
              <Chip
                key={id}
                label={l.title}
                onRemove={() => toggleLesson(id)}
              />
            );
          })}
          <TouchableOpacity
            style={styles.smallAdd}
            onPress={() => setLessonPickerOpen(true)}
            disabled={!subjectId}
          >
            <Ionicons name="add" size={22} color={ClassworkUi.title} />
          </TouchableOpacity>
        </View>
      </Labeled>
      <Labeled label="Select question types">
        <View style={styles.chipRow}>
          {selectedQuestionTypes.map((q) => (
            <Chip key={q} label={q} onRemove={() => toggleQuestionType(q)} />
          ))}
          <TouchableOpacity
            style={styles.smallAdd}
            onPress={() => setQtPickerOpen(true)}
          >
            <Ionicons name="add" size={22} color={ClassworkUi.title} />
          </TouchableOpacity>
        </View>
      </Labeled>
      <Labeled label="Quiz title">
        <TextInput
          style={styles.textInput}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Unit 1 Quiz"
          placeholderTextColor="#999"
        />
      </Labeled>
      <Labeled label="Duration (minutes)">
        <TextInput
          style={styles.textInput}
          value={quizDurationMin}
          onChangeText={setQuizDurationMin}
          placeholder="e.g. 30"
          placeholderTextColor="#999"
          keyboardType="numeric"
        />
      </Labeled>

      <Modal visible={lessonPickerOpen} transparent animationType="fade">
        <View style={styles.modalRoot}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setLessonPickerOpen(false)}
          />
          <View
            pointerEvents="box-none"
            style={[StyleSheet.absoluteFillObject, styles.modalCenter]}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Add lesson</Text>
              <FlatList
                style={{ maxHeight: 280 }}
                data={lessonsForSubject}
                keyExtractor={(item) => String(item.lesson_id)}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalRow}
                    onPress={() => {
                      toggleLesson(item.lesson_id);
                    }}
                  >
                    <Text style={styles.modalRowText}>{item.title}</Text>
                    <Ionicons
                      name={
                        selectedLessonIds.includes(item.lesson_id)
                          ? "checkmark-circle"
                          : "ellipse-outline"
                      }
                      size={22}
                    />
                  </TouchableOpacity>
                )}
              />
              <TouchableOpacity
                style={styles.modalDone}
                onPress={() => setLessonPickerOpen(false)}
              >
                <Text style={styles.modalDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={qtPickerOpen} transparent animationType="fade">
        <View style={styles.modalRoot}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setQtPickerOpen(false)}
          />
          <View
            pointerEvents="box-none"
            style={[StyleSheet.absoluteFillObject, styles.modalCenter]}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Question types</Text>
              {QUESTION_TYPES.map((q) => (
                <TouchableOpacity
                  key={q}
                  style={styles.modalRow}
                  onPress={() => toggleQuestionType(q)}
                >
                  <Text style={styles.modalRowText}>{q}</Text>
                  <Ionicons
                    name={
                      selectedQuestionTypes.includes(q)
                        ? "checkmark-circle"
                        : "ellipse-outline"
                    }
                    size={22}
                  />
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.modalDone}
                onPress={() => setQtPickerOpen(false)}
              >
                <Text style={styles.modalDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );

  const renderActivity = () => (
    <>
      <Labeled label="Activity title">
        <TextInput
          style={styles.textInput}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Group presentation task"
          placeholderTextColor="#999"
        />
      </Labeled>
      <Labeled label="Category">
        <FormDropdown
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={setCategory}
          placeholder="Select category"
        />
      </Labeled>
      <Labeled label="Subject">
        <FormDropdown
          options={subjectOptions}
          value={subjectId != null ? String(subjectId) : ""}
          onChange={(v) => setSubjectId(v ? Number(v) : null)}
          placeholder="Select subject"
        />
      </Labeled>
      <Labeled label="Lessons">
        <FormDropdown
          options={lessonOptions}
          value={lessonId != null ? String(lessonId) : ""}
          onChange={(v) => setLessonId(v ? Number(v) : null)}
          placeholder="Select lesson"
        />
      </Labeled>
      <UploadRow files={files} onAdd={pickFiles} onRemove={(i) => setFiles((p) => p.filter((_, idx) => idx !== i))} />
      <Labeled label="Submission">
        <Text style={styles.subLabel}>File type</Text>
        <View style={styles.chipRow}>
          {SUBMISSION_TYPES.map((s) => {
            const on = submissionIds.includes(s.id);
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.subChip, on && styles.subChipOn]}
                onPress={() => toggleSubmission(s.id)}
              >
                <Text style={styles.subChipText}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity style={styles.smallAdd} onPress={() => {}}>
            <Ionicons name="add" size={22} color={ClassworkUi.title} />
          </TouchableOpacity>
        </View>
      </Labeled>
    </>
  );

  const body = () => {
    switch (classworkType) {
      case "reading":
        return renderReading();
      case "assignment":
        return renderAssignment();
      case "quiz":
        return renderQuiz();
      case "activity":
        return renderActivity();
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.pageWrap}>
        <ClassworkModalShell
          title={SCREEN_TITLE[classworkType]}
          onClose={() => router.back()}
          footer={
            <FormFooter
              actions={[
                {
                  label: saving ? "Saving…" : primaryLabel,
                  onPress: () => {
                    if (!saving) void handlePrimary();
                  },
                },
              ]}
            />
          }
        >
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.formScroll}
            showsVerticalScrollIndicator={false}
          >
            {saving ? (
              <View style={styles.busy}>
                <ActivityIndicator size="large" color={ClassworkUi.title} />
              </View>
            ) : (
              body()
            )}
          </ScrollView>
        </ClassworkModalShell>
      </View>
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
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function UploadRow({
  files,
  onAdd,
  onRemove,
}: {
  files: UploadableFile[];
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>Upload material</Text>
      <View style={styles.addMaterialContainer}>
        {files.map((f, i) => (
          <MaterialCard
            key={`${f.name}-${i}`}
            filename={f.name}
            fileType={fileKindLabel(f.name)}
            onRemove={() => onRemove(i)}
          />
        ))}
        <AddButton onPress={onAdd} size="large" />
      </View>
    </View>
  );
}

function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText} numberOfLines={1}>
        {label}
      </Text>
      <TouchableOpacity onPress={onRemove} hitSlop={8}>
        <Ionicons name="close" size={16} color={ClassworkUi.title} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ClassworkUi.bodyBg },
  pageWrap: {
    flex: 1,
    padding: 16,
    justifyContent: "center",
  },
  formScroll: {
    padding: 16,
    paddingBottom: 24,
    gap: 16,
  },
  busy: { paddingVertical: 40, alignItems: "center" },
  fieldBlock: { gap: 6 },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: ClassworkUi.title,
  },
  subLabel: { fontSize: 12, color: "#555", marginBottom: 4 },
  textInput: {
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: "600",
    backgroundColor: "#fff",
    color: ClassworkUi.title,
  },
  textArea: {
    minHeight: 100,
    fontWeight: "400",
    textAlignVertical: "top",
  },
  addMaterialContainer: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    backgroundColor: "#fff",
    maxWidth: "100%",
  },
  chipText: { fontSize: 13, fontWeight: "600", maxWidth: 220 },
  smallAdd: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  subChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    backgroundColor: "#fff",
  },
  subChipOn: { backgroundColor: ClassworkUi.chipSelected },
  subChipText: { fontSize: 12, fontWeight: "600" },
  modalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  modalCenter: {
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    maxHeight: "70%",
    paddingVertical: 8,
  },
  modalTitle: {
    fontWeight: "700",
    fontSize: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  modalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  modalRowText: { flex: 1, fontSize: 14, paddingRight: 8 },
  modalDone: {
    marginTop: 8,
    padding: 14,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  modalDoneText: { fontWeight: "700", fontSize: 16 },
});

const rubricStyles = StyleSheet.create({
  wrapper: {
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fff",
  },
  title: {
    fontWeight: "700",
    fontSize: 14,
    marginBottom: 8,
  },
  row: { flexDirection: "row", gap: 8 },
  cell: {
    width: 120,
    padding: 8,
    borderWidth: 1,
    borderRadius: 8,
    gap: 4,
    borderColor: ClassworkUi.border,
  },
  cellHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  levelLabel: { fontWeight: "700", fontSize: 12 },
  pts: { fontSize: 11 },
  desc: { fontSize: 11, color: "#444" },
});
