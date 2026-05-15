import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '@/context/AuthContext';
import { useTeacherClasses } from '@/hooks/useTeacherData';
import { apiFetch, apiUploadSingle } from '@/hooks/api';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';
import DatePickerField from '@/components/teacher/date-picker-field';

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const TYPES = ['ASSIGNMENT', 'QUIZ', 'ACTIVITY', 'EXAM'] as const;
const CATEGORIES = ['WRITTEN_WORK', 'PERFORMANCE_TASK', 'PERIODICAL_EXAM'];

export default function CreateClasswork() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; subject_id?: string; class_id?: string; lesson_id?: string; lesson_title?: string }>();
  const { session } = useAuth();
  const { classes } = useTeacherClasses();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const initialType = (() => {
    const incoming = (params.type || '').toUpperCase();
    if (incoming === 'QUIZ') return 'QUIZ' as const;
    if (incoming === 'ACTIVITY') return 'ACTIVITY' as const;
    return 'ASSIGNMENT' as const;
  })();
  const [cwType, setCwType] = useState<(typeof TYPES)[number]>(initialType);
  const [cwCategory, setCwCategory] = useState<string | null>(null);
  const [totalPoints, setTotalPoints] = useState('100');
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [selectedClasses, setSelectedClasses] = useState<number[]>([]);
  const [files, setFiles] = useState<{ uri: string; name: string; type: string; webFile?: Blob }[]>([]);
  const [maxAttempts, setMaxAttempts] = useState('1');
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [publishDate, setPublishDate] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const sid = params.subject_id != null ? Number(params.subject_id) : NaN;
    const cid = params.class_id != null ? Number(params.class_id) : NaN;
    if (Number.isFinite(sid) && sid > 0) setSubjectId(sid);
    if (Number.isFinite(cid) && cid > 0) setSelectedClasses([cid]);
  }, [params.subject_id, params.class_id]);

  const linkedLessonId = (() => {
    const id = params.lesson_id != null ? Number(params.lesson_id) : NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  })();

  const uniqueSubjects = classes.reduce((acc, c) => {
    if (!acc.find((s) => s.subject_id === c.subject_id)) acc.push(c);
    return acc;
  }, [] as typeof classes);
  const filteredClasses = subjectId ? classes.filter((c) => c.subject_id === subjectId) : [];

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'image/jpeg', 'image/png'],
      multiple: true,
    });
    if (!result.canceled && result.assets) {
      const picked = result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        type: a.mimeType || 'application/octet-stream',
        size: a.size || 0,
        webFile: (a as any).file as Blob | undefined,
      }));
      const oversized = picked.filter((file) => file.size > MAX_FILE_SIZE);
      if (oversized.length > 0) {
        Alert.alert(
          'File too large',
          `These files exceed 4MB: ${oversized.map((file) => file.name).join(', ')}`
        );
        return;
      }
      setFiles((p) =>
        [
          ...p,
          ...picked.map(({ size, ...file }) => file),
        ]
      );
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Title is required');
      return;
    }
    if (!subjectId) {
      Alert.alert('Error', 'Select a subject');
      return;
    }
    if (selectedClasses.length === 0) {
      Alert.alert('Error', 'Assign to at least one class');
      return;
    }

    setSaving(true);
    try {
      // Create classwork
      const isExamType = cwType === 'EXAM';
      const backendType = isExamType ? 'QUIZ' : cwType;
      const backendCategory = isExamType ? 'PERIODICAL_EXAM' : cwCategory;

      const cw = await apiFetch('/api/v1/classwork-assignments/', {
        method: 'POST',
        token: session!.token,
        body: JSON.stringify({
          title,
          description,
          instructions,
          classwork_type: backendType,
          classwork_category: backendCategory,
          total_points: parseFloat(totalPoints) || 100,
          subject_id: subjectId,
          is_published: true,
          lesson_ids: linkedLessonId ? [linkedLessonId] : [],
        }),
      });

      // Upload attachments
      for (const f of files) {
        await apiUploadSingle(`/api/v1/classwork-assignments/classwork/${cw.classwork_id}/attachments`, f, session!.token);
      }

      // Assign to classes
      if (selectedClasses.length > 0) {
        await apiFetch(`/api/v1/classwork-assignments/classwork/${cw.classwork_id}/assign`, {
          method: 'POST',
          token: session!.token,
          body: JSON.stringify({
            class_ids: selectedClasses,
            is_published: true,
            publish_date: (publishDate ?? new Date()).toISOString(),
            due_date: dueDate ? dueDate.toISOString() : null,
            max_attempts: parseInt(maxAttempts) || 1,
          }),
        });
      }

      Alert.alert('Success', linkedLessonId ? 'Classwork created under this lesson!' : 'Classwork created and assigned!');
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleClass = (id: number) => setSelectedClasses((p) => (p.includes(id) ? p.filter((c) => c !== id) : [...p, id]));

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>{linkedLessonId ? 'Add Classwork to Lesson' : 'Create Classwork'}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        {linkedLessonId && params.lesson_title ? (
          <View style={s.lessonBanner}>
            <Ionicons name="book-outline" size={18} color={AppColors.foreground} />
            <Text style={s.lessonBannerText} numberOfLines={2}>
              {params.lesson_title}
            </Text>
          </View>
        ) : null}
        <View style={s.field}>
          <Text style={s.label}>Title *</Text>
          <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="Classwork title" placeholderTextColor={AppColors.placeholder} />
        </View>
        <View style={s.field}>
          <Text style={s.label}>Description</Text>
          <TextInput style={[s.input, s.textArea]} value={description} onChangeText={setDescription} placeholder="Brief description" multiline placeholderTextColor={AppColors.placeholder} />
        </View>
        <View style={s.field}>
          <Text style={s.label}>Instructions</Text>
          <TextInput style={[s.input, s.textArea]} value={instructions} onChangeText={setInstructions} placeholder="Student instructions..." multiline numberOfLines={4} placeholderTextColor={AppColors.placeholder} />
        </View>
        <View style={s.field}>
          <Text style={s.label}>Type</Text>
          <View style={s.chipRow}>
            {TYPES.map((t) => (
              <TouchableOpacity key={t} style={[s.chip, cwType === t && s.chipActive]} onPress={() => setCwType(t)}>
                <Text style={[s.chipText, cwType === t && s.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={s.field}>
          <Text style={s.label}>Category</Text>
          <View style={s.chipRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity key={c} style={[s.chip, cwCategory === c && s.chipActive]} onPress={() => setCwCategory(cwCategory === c ? null : c)}>
                <Text style={[s.chipText, cwCategory === c && s.chipTextActive]}>{c.replace(/_/g, ' ')}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={s.field}>
          <Text style={s.label}>Total Points</Text>
          <TextInput style={s.input} value={totalPoints} onChangeText={setTotalPoints} keyboardType="numeric" placeholderTextColor={AppColors.placeholder} />
        </View>
        <View style={s.field}>
          <Text style={s.label}>Max Attempts</Text>
          <TextInput style={s.input} value={maxAttempts} onChangeText={setMaxAttempts} keyboardType="numeric" placeholder="1" placeholderTextColor={AppColors.placeholder} />
        </View>
        <View style={s.field}>
          <Text style={s.label}>Subject *</Text>
          <View style={s.chipRow}>
            {uniqueSubjects.map((sub) => (
              <TouchableOpacity key={sub.subject_id} style={[s.chip, subjectId === sub.subject_id && s.chipActive]} onPress={() => setSubjectId(sub.subject_id)}>
                <Text style={[s.chipText, subjectId === sub.subject_id && s.chipTextActive]}>{sub.subject_name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        {filteredClasses.length > 0 && (
          <View style={s.field}>
            <Text style={s.label}>Assign to Classes *</Text>
            <View style={s.chipRow}>
              {filteredClasses.map((c) => (
                <TouchableOpacity
                  key={c.class_id}
                  style={[s.chip, selectedClasses.includes(c.class_id) && s.chipActive]}
                  onPress={() => toggleClass(c.class_id)}
                >
                  <Text style={[s.chipText, selectedClasses.includes(c.class_id) && s.chipTextActive]}>{c.section_name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        <View style={s.field}>
          <DatePickerField
            label="Publish date"
            value={publishDate}
            onChange={setPublishDate}
            placeholder="Optional — defaults to today if cleared in flow"
          />
        </View>
        <View style={s.field}>
          <DatePickerField
            label="Due date (optional)"
            value={dueDate}
            onChange={setDueDate}
            minimumDate={publishDate ?? undefined}
          />
        </View>
        <View style={s.field}>
          <Text style={s.label}>Attachments</Text>
          <TouchableOpacity style={s.fileButton} onPress={pickFile}>
            <Ionicons name="cloud-upload-outline" size={20} color={AppColors.foreground} />
            <Text style={s.fileButtonText}>Pick Files (4MB max)</Text>
          </TouchableOpacity>
          {files.map((f, i) => (
            <View key={i} style={s.fileItem}>
              <Ionicons name="document-outline" size={16} color={AppColors.mutedForeground} />
              <Text style={s.fileName} numberOfLines={1}>
                {f.name}
              </Text>
              <TouchableOpacity onPress={() => setFiles((p) => p.filter((_, idx) => idx !== i))}>
                <Ionicons name="close-circle" size={18} color={AppColors.destructive} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <TouchableOpacity style={[s.saveButton, saving && { opacity: 0.7 }]} onPress={handleSave} disabled={saving} activeOpacity={0.8}>
          {saving ? <ActivityIndicator color={AppColors.primaryForeground} /> : <Text style={s.saveButtonText}>Create Classwork</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 14, borderBottomWidth: Borders.width, borderBottomColor: AppColors.border },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  form: { padding: Spacing.lg, gap: 20, paddingBottom: 40 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  input: { borderWidth: Borders.width, borderColor: AppColors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: AppColors.foreground, backgroundColor: AppColors.white, ...NeoShadow.xs },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: Borders.width, borderColor: AppColors.border, backgroundColor: AppColors.white },
  chipActive: { backgroundColor: AppColors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: AppColors.foreground },
  chipTextActive: { color: AppColors.primaryForeground },
  fileButton: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderWidth: Borders.width, borderColor: AppColors.border, borderStyle: 'dashed', backgroundColor: AppColors.inputBackground },
  fileButtonText: { fontSize: 13, color: AppColors.mutedForeground, flex: 1 },
  fileItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: AppColors.muted, borderWidth: 1, borderColor: AppColors.border },
  fileName: { flex: 1, fontSize: 13, color: AppColors.foreground },
  saveButton: { backgroundColor: AppColors.primary, borderWidth: Borders.width, borderColor: AppColors.border, paddingVertical: 14, alignItems: 'center', ...NeoShadow.md },
  saveButtonText: { fontSize: 16, fontWeight: '900', color: AppColors.primaryForeground },
  lessonBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderWidth: Borders.width, borderColor: AppColors.border, borderRadius: 8, backgroundColor: AppColors.muted },
  lessonBannerText: { flex: 1, fontSize: 13, fontWeight: '800', color: AppColors.foreground },
});
