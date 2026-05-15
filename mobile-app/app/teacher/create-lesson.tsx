import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, Switch, StyleSheet, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '@/context/AuthContext';
import { useTeacherClasses } from '@/hooks/useTeacherData';
import { apiFetch, apiUploadSingle } from '@/hooks/api';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

export default function CreateLesson() {
  const router = useRouter();
  const { session } = useAuth();
  const { classes } = useTeacherClasses();
  const prefill = useLocalSearchParams<{ 
    subject_load_id?: string;
    class_id?: string;
    subject_id?: string;
    subject?: string;
    section?: string;
  }>();

  const goBackToSubject = () => {
    if (prefill.class_id && prefill.subject_id) {
      router.replace({
        pathname: '/teacher/subject-detail' as any,
        params: {
          subject_load_id: prefill.subject_load_id,
          class_id: prefill.class_id,
          subject_id: prefill.subject_id,
          subject: prefill.subject,
          section: prefill.section,
        }
      });
    } else {
      router.replace('/teacher/lessons' as any);
    }
  };

  const [title, setTitle]               = useState('');
  const [description, setDescription]   = useState('');
  const [content, setContent]           = useState('');
  const [subjectId, setSubjectId]       = useState<number | null>(null);
  const [selectedClasses, setSelectedClasses] = useState<number[]>([]);
  const [isPublished, setIsPublished]   = useState(true);
  const [files, setFiles]               = useState<{ uri: string; name: string; type: string; webFile?: Blob }[]>([]);
  const [saving, setSaving]             = useState(false);

  useEffect(() => {
    const sid = prefill.subject_id != null ? Number(prefill.subject_id) : NaN;
    const cid = prefill.class_id != null ? Number(prefill.class_id) : NaN;
    if (Number.isFinite(sid) && sid > 0) setSubjectId(sid);
    if (Number.isFinite(cid) && cid > 0) setSelectedClasses([cid]);
  }, [prefill.subject_id, prefill.class_id]);

  // Derive unique subjects from teacher's class-loads
  const uniqueSubjects = classes.reduce((acc, c) => {
    if (!acc.find((s) => s.subject_id === c.subject_id)) acc.push(c);
    return acc;
  }, [] as typeof classes);

  const filteredClasses = subjectId
    ? classes.filter((c) => c.subject_id === subjectId)
    : [];

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'image/jpeg',
        'image/png',
      ],
      multiple: true,
    });
    if (!result.canceled && result.assets) {
      const newFiles = result.assets.map((a) => ({
        uri:  a.uri,
        name: a.name,
        type: a.mimeType || 'application/octet-stream',
        webFile: (a as any).file as Blob | undefined,
      }));
      setFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const toggleClass = (id: number) =>
    setSelectedClasses((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );

  const handleSave = async () => {
    if (!title.trim())  { Alert.alert('Required', 'Please enter a lesson title.');   return; }
    if (!subjectId)     { Alert.alert('Required', 'Please select a subject.');       return; }
    if (selectedClasses.length === 0) {
      Alert.alert('Required', 'Please select at least one class to assign this lesson to.');
      return;
    }

    setSaving(true);
    try {
      // 1. Create the lesson
      const lesson = await apiFetch<{ lesson_id: number }>(
        '/api/v1/lessons/',
        {
          method: 'POST',
          token:  session!.token,
          body:   JSON.stringify({
            title,
            description:  description || null,
            content:      content     || null,
            subject_id:   subjectId,
            is_published: isPublished,
            order_index:  1,
          }),
        },
      );

      // 2. Assign to selected classes so the lesson is retrievable even if an attachment fails.
      await apiFetch(
        `/api/v1/lessons/${lesson.lesson_id}/assign`,
        {
          method: 'POST',
          token:  session!.token,
          body:   JSON.stringify({ class_ids: selectedClasses, is_published: isPublished }),
        },
      );

      // 3. Upload attachments
      for (const f of files) {
        await apiUploadSingle(
          `/api/v1/lessons/${lesson.lesson_id}/attachments`,
          f,
          session!.token,
        );
      }

      if (Platform.OS === 'web') {
        setTimeout(() => {
          window.alert(`✅ Lesson Created\n"${title}" has been ${isPublished ? 'published' : 'saved as draft'} successfully.`);
          goBackToSubject();
        }, 50);
        return;
      }
      setTimeout(() => {
        Alert.alert(
        '✅ Lesson Created',
        `"${title}" has been ${isPublished ? 'published' : 'saved as draft'} successfully.`,
        [{ 
          text: 'OK', 
          onPress: () => goBackToSubject()
        }],
      );
      }, 50);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to create lesson. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={styles.headerTitle}>Create Lesson</Text>
        </TouchableOpacity>
        <View style={[styles.draftPill, isPublished ? styles.draftPillPublish : styles.draftPillDraft]}>
          <Ionicons
            name={isPublished ? 'radio-button-on' : 'save-outline'}
            size={12}
            color={isPublished ? '#166534' : AppColors.mutedForeground}
          />
          <Text style={[styles.draftPillText, isPublished ? styles.draftPillPublishText : styles.draftPillDraftText]}>
            {isPublished ? 'Will Publish' : 'Draft'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <View style={styles.field}>
          <Text style={styles.label}>Title <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Introduction to Variables"
            placeholderTextColor={AppColors.placeholder}
          />
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Brief overview of what this lesson covers"
            placeholderTextColor={AppColors.placeholder}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Content */}
        <View style={styles.field}>
          <Text style={styles.label}>Content</Text>
          <TextInput
            style={[styles.input, styles.textAreaLarge]}
            value={content}
            onChangeText={setContent}
            placeholder="Write the full lesson content here..."
            placeholderTextColor={AppColors.placeholder}
            multiline
            numberOfLines={6}
          />
        </View>

        {/* Subject picker */}
        <View style={styles.field}>
          <Text style={styles.label}>Subject <Text style={styles.required}>*</Text></Text>
          {uniqueSubjects.length === 0 ? (
            <Text style={styles.hint}>No subjects assigned to you yet.</Text>
          ) : (
            <View style={styles.chipRow}>
              {uniqueSubjects.map((s) => (
                <TouchableOpacity
                  key={s.subject_id}
                  style={[styles.chip, subjectId === s.subject_id && styles.chipActive]}
                  onPress={() => { setSubjectId(s.subject_id); setSelectedClasses([]); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, subjectId === s.subject_id && styles.chipTextActive]}>
                    {s.subject_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Class picker — only shown after subject is selected */}
        {filteredClasses.length > 0 && (
          <View style={styles.field}>
            <Text style={styles.label}>Assign to Classes <Text style={styles.required}>*</Text></Text>
            <Text style={styles.hint}>Select which sections will see this lesson.</Text>
            <View style={styles.chipRow}>
              {filteredClasses.map((c) => (
                <TouchableOpacity
                  key={c.class_id}
                  style={[styles.chip, selectedClasses.includes(c.class_id) && styles.chipActive]}
                  onPress={() => toggleClass(c.class_id)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={selectedClasses.includes(c.class_id) ? 'checkmark-circle' : 'ellipse-outline'}
                    size={14}
                    color={selectedClasses.includes(c.class_id) ? AppColors.primaryForeground : AppColors.foreground}
                  />
                  <Text style={[styles.chipText, selectedClasses.includes(c.class_id) && styles.chipTextActive]}>
                    {c.section_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Publish toggle */}
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Publish immediately</Text>
            <Text style={styles.hint}>Off = saved as draft; students will not see it.</Text>
          </View>
          <Switch
            value={isPublished}
            onValueChange={setIsPublished}
            trackColor={{ false: AppColors.muted, true: AppColors.primary }}
            thumbColor={AppColors.card}
          />
        </View>

        {/* File attachments */}
        <View style={styles.field}>
          <Text style={styles.label}>Attachments</Text>
          <TouchableOpacity style={styles.fileButton} onPress={pickFile} activeOpacity={0.8}>
            <Ionicons name="cloud-upload-outline" size={20} color={AppColors.foreground} />
            <Text style={styles.fileButtonText}>
              Attach Files (PDF, DOCX, PPTX, JPG, PNG · max 4 MB each)
            </Text>
          </TouchableOpacity>
          {files.map((f, i) => (
            <View key={i} style={styles.fileItem}>
              <Ionicons name="document-outline" size={16} color={AppColors.mutedForeground} />
              <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
              <TouchableOpacity onPress={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}>
                <Ionicons name="close-circle" size={18} color={AppColors.destructive} />
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Full-width save button at bottom */}
        <TouchableOpacity
          style={[styles.createButton, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={AppColors.primaryForeground} />
            : (
              <>
                <Ionicons
                  name={isPublished ? 'cloud-upload-outline' : 'save-outline'}
                  size={20}
                  color={AppColors.primaryForeground}
                />
                <Text style={styles.createButtonText}>
                  {isPublished ? 'Publish Lesson' : 'Save Draft'}
                </Text>
              </>
            )
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 14,
    borderBottomWidth: Borders.width, borderBottomColor: AppColors.border,
  },
  backRow:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  draftPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: Borders.width, borderRadius: 999,
  },
  draftPillPublish: { backgroundColor: '#dcfce7', borderColor: '#166534' },
  draftPillDraft:   { backgroundColor: AppColors.muted, borderColor: AppColors.border },
  draftPillText: { fontSize: 11, fontWeight: '800' },
  draftPillPublishText: { color: '#166534' },
  draftPillDraftText:   { color: AppColors.mutedForeground },
  form: { padding: Spacing.lg, gap: 20, paddingBottom: 48 },
  field:    { gap: 8 },
  label:    { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  required: { color: AppColors.destructive },
  hint:     { fontSize: 12, color: AppColors.mutedForeground },
  input: {
    borderWidth: Borders.width, borderColor: AppColors.border,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: AppColors.foreground,
    backgroundColor: AppColors.white, ...NeoShadow.xs,
  },
  textArea:      { minHeight: 80,  textAlignVertical: 'top' },
  textAreaLarge: { minHeight: 140, textAlignVertical: 'top' },
  chipRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: Borders.width, borderColor: AppColors.border,
    borderRadius: 999, backgroundColor: AppColors.white,
  },
  chipActive:     { backgroundColor: AppColors.primary, borderColor: AppColors.primary },
  chipText:       { fontSize: 13, fontWeight: '600', color: AppColors.foreground },
  chipTextActive: { color: AppColors.primaryForeground },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderWidth: Borders.width, borderColor: AppColors.border,
    borderRadius: 10, backgroundColor: AppColors.card,
  },
  fileButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14,
    borderWidth: Borders.width, borderColor: AppColors.border,
    borderStyle: 'dashed', backgroundColor: AppColors.muted,
  },
  fileButtonText: { fontSize: 13, color: AppColors.mutedForeground, flex: 1 },
  fileItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: AppColors.muted, borderWidth: 1, borderColor: AppColors.border,
    borderRadius: 6,
  },
  fileName:      { flex: 1, fontSize: 13, color: AppColors.foreground },
  createButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: AppColors.primary, paddingVertical: 16,
    borderWidth: Borders.width, borderColor: AppColors.border,
    borderRadius: 10, ...NeoShadow.md,
  },
  createButtonText: { fontSize: 16, fontWeight: '900', color: AppColors.primaryForeground },
});
