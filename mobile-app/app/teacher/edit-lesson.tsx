import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Switch, StyleSheet, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, apiUploadSingle } from '@/hooks/api';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';
import type { TeacherLesson } from '@/hooks/useTeacherData';

const MAX_FILE_SIZE = 4 * 1024 * 1024;

export default function EditLesson() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    lesson_id?: string;
    subject_load_id?: string;
    class_id?: string;
    subject_id?: string;
    subject?: string;
    section?: string;
  }>();
  const { session } = useAuth();

  const [lesson, setLesson] = useState<TeacherLesson | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [newFiles, setNewFiles] = useState<{ uri: string; name: string; type: string; webFile?: Blob }[]>([]);
  const [removedAttachments, setRemovedAttachments] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const lessonId = params.lesson_id ? parseInt(params.lesson_id, 10) : null;
  const validLessonId = lessonId !== null && !isNaN(lessonId) && lessonId > 0;

  const goBackToSubject = () => {
    if (params.class_id && params.subject_id) {
      router.replace({
        pathname: '/teacher/subject-detail' as any,
        params: {
          subject_load_id: params.subject_load_id,
          class_id: params.class_id,
          subject_id: params.subject_id,
          subject: params.subject,
          section: params.section,
        }
      });
    } else {
      router.replace('/teacher/lessons' as any);
    }
  };

  useEffect(() => {
    if (!session?.token || !validLessonId) {
      setLoading(false);
      return;
    }

    const fetchLesson = async () => {
      try {
        const data = await apiFetch<TeacherLesson>(`/api/v1/lessons/${lessonId}`, { token: session.token });
        setLesson(data);
        setTitle(data.title);
        setDescription(data.description || '');
        setContent(data.content || '');
        setIsPublished(data.is_published);
      } catch (e: any) {
        Alert.alert('Error', e.message);
      } finally {
        setLoading(false);
      }
    };

    fetchLesson();
  }, [session?.token, lessonId]);

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
      const picked = result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        type: a.mimeType || 'application/octet-stream',
        size: a.size || 0,
        webFile: (a as any).file as Blob | undefined,
      }));

      const oversized = picked.filter((f) => f.size > MAX_FILE_SIZE);
      if (oversized.length > 0) {
        Alert.alert('File too large', `These files exceed 4MB: ${oversized.map((f) => f.name).join(', ')}`);
        return;
      }

      setNewFiles((p) => [...p, ...picked.map(({ size, ...file }) => file)]);
    }
  };

  const handleRemoveNewFile = (index: number) => {
    setNewFiles((p) => p.filter((_, i) => i !== index));
  };

  const handleRemoveExistingAttachment = (attachmentId: number) => {
    setRemovedAttachments((p) => [...p, attachmentId]);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Title is required');
      return;
    }
    if (!validLessonId) {
      Alert.alert('Error', 'Invalid lesson ID. Please go back and try again.');
      return;
    }

    setSaving(true);
    try {
      await apiFetch(`/api/v1/lessons/${lessonId}`, {
        method: 'PUT',
        token: session!.token,
        body: JSON.stringify({
          title,
          description: description || null,
          content: content || null,
          is_published: isPublished,
          is_draft: !isPublished,
        }),
      });

      for (const attId of removedAttachments) {
        try {
          await apiFetch(`/api/v1/lessons/${lessonId}/attachments/${attId}`, {
            method: 'DELETE',
            token: session!.token,
          });
        } catch (e) {
          console.error('Failed to delete attachment', attId, e);
        }
      }

      for (const file of newFiles) {
        await apiUploadSingle(`/api/v1/lessons/${lessonId}/attachments`, file, session!.token);
      }

      Alert.alert('Success', 'Lesson updated successfully!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmAndDelete = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/v1/lessons/${lessonId}`, {
        method: 'DELETE',
        token: session!.token,
      });
      setSaving(false);
      // Navigate immediately without waiting for an OK tap — list is already stale
      goBackToSubject();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to delete lesson');
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!validLessonId) {
      Alert.alert('Error', 'Invalid lesson ID. Please go back and try again.');
      return;
    }

    if (Platform.OS === 'web') {
      setTimeout(() => {
        const confirmed = window.confirm(
          'Are you sure you want to delete this lesson? All associated classworks and attachments will also be permanently deleted.'
        );
        if (confirmed) confirmAndDelete();
      }, 50);
      return;
    }

    setTimeout(() => {
      Alert.alert(
        'Delete Lesson',
        'Are you sure you want to delete this lesson? All associated classworks and attachments will also be permanently deleted.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: confirmAndDelete },
        ]
      );
    }, 50);
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={AppColors.primary} />
          <Text style={s.loadingHint}>Loading lesson…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const existingAttachments = lesson?.attachments || [];
  const visibleAttachments = existingAttachments.filter(
    (a) => !removedAttachments.includes(a.lesson_attachment_id)
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>Edit Lesson</Text>
        </TouchableOpacity>
        <View style={[s.draftPill, isPublished ? s.draftPillPublish : s.draftPillDraft]}>
          <Ionicons
            name={isPublished ? 'eye-outline' : 'save-outline'}
            size={12}
            color={isPublished ? '#166534' : AppColors.mutedForeground}
          />
          <Text style={[s.draftPillText, isPublished ? s.draftPillPublishText : s.draftPillDraftText]}>
            {isPublished ? 'Published' : 'Draft'}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <View style={s.field}>
          <Text style={s.label}>Title <Text style={s.required}>*</Text></Text>
          <TextInput
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Lesson title"
            placeholderTextColor={AppColors.placeholder}
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>Description</Text>
          <TextInput
            style={[s.input, s.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Brief description"
            multiline
            numberOfLines={3}
            placeholderTextColor={AppColors.placeholder}
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>Content</Text>
          <TextInput
            style={[s.input, s.textAreaLarge]}
            value={content}
            onChangeText={setContent}
            placeholder="Write the full lesson content here..."
            multiline
            numberOfLines={6}
            placeholderTextColor={AppColors.placeholder}
          />
        </View>

        <View style={s.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Publish immediately</Text>
            <Text style={s.hint}>Off = saved as draft; students will not see it.</Text>
          </View>
          <Switch
            value={isPublished}
            onValueChange={setIsPublished}
            trackColor={{ false: AppColors.muted, true: AppColors.primary }}
            thumbColor={AppColors.card}
          />
        </View>

        {visibleAttachments.length > 0 && (
          <View style={s.field}>
            <Text style={s.label}>Current Attachments</Text>
            {visibleAttachments.map((file) => (
              <View key={file.lesson_attachment_id} style={s.attachmentRow}>
                <Ionicons name="document-text-outline" size={18} color={AppColors.foreground} />
                <View style={{ flex: 1 }}>
                  <Text style={s.fileName} numberOfLines={1}>{file.file_name}</Text>
                  {file.file_size ? (
                    <Text style={s.fileSize}>{(file.file_size / 1024).toFixed(0)} KB</Text>
                  ) : null}
                </View>
                <TouchableOpacity onPress={() => handleRemoveExistingAttachment(file.lesson_attachment_id)}>
                  <Ionicons name="trash-outline" size={18} color={AppColors.destructive} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={s.field}>
          <Text style={s.label}>Add More Files</Text>
          <TouchableOpacity style={s.fileButton} onPress={pickFile} activeOpacity={0.8}>
            <Ionicons name="cloud-upload-outline" size={20} color={AppColors.foreground} />
            <Text style={s.fileButtonText}>Pick Files (4MB max)</Text>
          </TouchableOpacity>
          {newFiles.map((f, i) => (
            <View key={i} style={s.fileItem}>
              <Ionicons name="document-outline" size={16} color={AppColors.mutedForeground} />
              <Text style={s.fileName} numberOfLines={1}>{f.name}</Text>
              <TouchableOpacity onPress={() => handleRemoveNewFile(i)}>
                <Ionicons name="close-circle" size={18} color={AppColors.destructive} />
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[s.saveButton, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={AppColors.primaryForeground} />
          ) : (
            <>
              <Ionicons
                name={isPublished ? 'cloud-upload-outline' : 'save-outline'}
                size={20}
                color={AppColors.primaryForeground}
              />
              <Text style={s.saveButtonText}>
                {isPublished ? 'Publish Changes' : 'Save Draft Changes'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.deleteButton}
          onPress={handleDelete}
          activeOpacity={0.8}
        >
          <Ionicons name="trash-outline" size={18} color={AppColors.destructive} />
          <Text style={s.deleteButtonText}>Delete Lesson</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 14,
    borderBottomWidth: Borders.width, borderBottomColor: AppColors.border,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  draftPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: Borders.width, borderRadius: 999,
  },
  draftPillPublish: { backgroundColor: '#dcfce7', borderColor: '#166534' },
  draftPillDraft: { backgroundColor: AppColors.muted, borderColor: AppColors.border },
  draftPillText: { fontSize: 11, fontWeight: '800' },
  draftPillPublishText: { color: '#166534' },
  draftPillDraftText: { color: AppColors.mutedForeground },
  form: { padding: Spacing.lg, gap: 20, paddingBottom: 40 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  loadingHint: { fontSize: 14, color: AppColors.mutedForeground, fontWeight: '600' },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  required: { color: AppColors.destructive },
  hint: { fontSize: 12, color: AppColors.mutedForeground },
  input: {
    borderWidth: Borders.width, borderColor: AppColors.border,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: AppColors.foreground,
    backgroundColor: AppColors.white, borderRadius: 6, ...NeoShadow.xs,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  textAreaLarge: { minHeight: 140, textAlignVertical: 'top' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderWidth: Borders.width, borderColor: AppColors.border,
    borderRadius: 10, backgroundColor: AppColors.card,
  },
  attachmentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 10,
    backgroundColor: AppColors.muted, borderWidth: Borders.width,
    borderColor: AppColors.border, borderRadius: 6, marginBottom: 6,
  },
  fileName: { flex: 1, fontSize: 13, fontWeight: '600', color: AppColors.foreground },
  fileSize: { fontSize: 11, color: AppColors.mutedForeground, marginTop: 2 },
  fileButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14,
    borderWidth: Borders.width, borderColor: AppColors.border,
    borderStyle: 'dashed', backgroundColor: AppColors.inputBackground, borderRadius: 6,
  },
  fileButtonText: { fontSize: 13, color: AppColors.mutedForeground, flex: 1 },
  fileItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, paddingHorizontal: 8,
    backgroundColor: AppColors.muted, borderWidth: 1,
    borderColor: AppColors.border, borderRadius: 6, marginBottom: 6,
  },
  saveButton: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    backgroundColor: AppColors.primary, borderWidth: Borders.width,
    borderColor: AppColors.border, paddingVertical: 14,
    borderRadius: 6, ...NeoShadow.md,
  },
  saveButtonText: { fontSize: 16, fontWeight: '900', color: AppColors.primaryForeground },
  deleteButton: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    backgroundColor: AppColors.inputBackground, borderWidth: Borders.width,
    borderColor: AppColors.border, paddingVertical: 14,
    borderRadius: 6, marginTop: 4,
  },
  deleteButtonText: { fontSize: 15, fontWeight: '800', color: AppColors.destructive },
});