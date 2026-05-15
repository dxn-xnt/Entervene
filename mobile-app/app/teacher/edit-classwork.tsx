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

type ClassworkData = {
  classwork_id: number;
  title: string;
  description: string | null;
  instructions: string | null;
  classwork_type: string;
  classwork_category: string | null;
  total_points: number | null;
  is_published: boolean;
  subject_id: number;
  attachments: {
    classwork_attachment_id: number;
    file_name: string;
    file_size?: number;
  }[];
};

export default function EditClasswork() {
  const router = useRouter();
  const params = useLocalSearchParams<{ classwork_id?: string }>();
  const { session } = useAuth();
  const { classes } = useTeacherClasses();

  const [cw, setCw] = useState<ClassworkData | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [cwType, setCwType] = useState<(typeof TYPES)[number]>('ASSIGNMENT');
  const [cwCategory, setCwCategory] = useState<string | null>(null);
  const [totalPoints, setTotalPoints] = useState('100');
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [newFiles, setNewFiles] = useState<{ uri: string; name: string; type: string; webFile?: Blob }[]>([]);
  const [removedAttachments, setRemovedAttachments] = useState<number[]>([]);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const classworkId = params.classwork_id ? Number(params.classwork_id) : null;

  useEffect(() => {
    if (!session?.token || !classworkId) {
      setLoading(false);
      return;
    }

    const fetchClasswork = async () => {
      try {
        const data = await apiFetch<ClassworkData>(
          `/api/v1/classwork-assignments/classwork/${classworkId}`,
          { token: session.token }
        );
        setCw(data);
        setTitle(data.title);
        setDescription(data.description || '');
        setInstructions(data.instructions || '');
        setCwType((data.classwork_type.toUpperCase() as any) || 'ASSIGNMENT');
        setCwCategory(data.classwork_category || null);
        setTotalPoints(String(data.total_points || 100));
        setSubjectId(data.subject_id);
      } catch (e: any) {
        Alert.alert('Error', e.message);
      } finally {
        setLoading(false);
      }
    };

    fetchClasswork();
  }, [session?.token, classworkId]);

  const uniqueSubjects = classes.reduce((acc, c) => {
    if (!acc.find((s) => s.subject_id === c.subject_id)) acc.push(c);
    return acc;
  }, [] as typeof classes);

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

      const oversized = picked.filter((file) => file.size > MAX_FILE_SIZE);
      if (oversized.length > 0) {
        Alert.alert(
          'File too large',
          `These files exceed 4MB: ${oversized.map((file) => file.name).join(', ')}`
        );
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

    if (!classworkId) {
      Alert.alert('Error', 'Classwork ID missing');
      return;
    }

    setSaving(true);
    try {
      // Update classwork metadata
      const isExamType = cwType === 'EXAM';
      const backendType = isExamType ? 'QUIZ' : cwType;
      const backendCategory = isExamType ? 'PERIODICAL_EXAM' : cwCategory;

      await apiFetch(`/api/v1/classwork-assignments/classwork/${classworkId}`, {
        method: 'PUT',
        token: session!.token,
        body: JSON.stringify({
          title,
          description,
          instructions,
          classwork_type: backendType,
          classwork_category: backendCategory,
          total_points: parseFloat(totalPoints) || 100,
        }),
      });

      // Upload new attachments
      for (const file of newFiles) {
        await apiUploadSingle(
          `/api/v1/classwork-assignments/classwork/${classworkId}/attachments`,
          file,
          session!.token
        );
      }

      // Note: Deleting attachments would require a backend endpoint
      // For now, just notify about removed files
      if (removedAttachments.length > 0) {
        console.log('Removed attachments:', removedAttachments);
        // When backend adds DELETE endpoint: await apiFetch(...DELETE..., { token })
      }

      Alert.alert('Success', 'Classwork updated successfully!');
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={AppColors.primary} />
          <Text style={s.loadingHint}>Loading classwork…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const existingAttachments = cw?.attachments || [];
  const visibleAttachments = existingAttachments.filter(
    (a) => !removedAttachments.includes(a.classwork_attachment_id)
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>Edit Classwork</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <View style={s.field}>
          <Text style={s.label}>Title *</Text>
          <TextInput
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Classwork title"
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
            placeholderTextColor={AppColors.placeholder}
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>Instructions</Text>
          <TextInput
            style={[s.input, s.textArea]}
            value={instructions}
            onChangeText={setInstructions}
            placeholder="Student instructions..."
            multiline
            numberOfLines={4}
            placeholderTextColor={AppColors.placeholder}
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>Type</Text>
          <View style={s.chipRow}>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.chip, cwType === t && s.chipActive]}
                onPress={() => setCwType(t)}
              >
                <Text style={[s.chipText, cwType === t && s.chipTextActive]}>
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Category</Text>
          <View style={s.chipRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[s.chip, cwCategory === c && s.chipActive]}
                onPress={() => setCwCategory(cwCategory === c ? null : c)}
              >
                <Text style={[s.chipText, cwCategory === c && s.chipTextActive]}>
                  {c.replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Total Points</Text>
          <TextInput
            style={s.input}
            value={totalPoints}
            onChangeText={setTotalPoints}
            keyboardType="numeric"
            placeholderTextColor={AppColors.placeholder}
          />
        </View>

        {/* Existing Attachments */}
        {visibleAttachments.length > 0 && (
          <View style={s.field}>
            <Text style={s.label}>Current Attachments</Text>
            {visibleAttachments.map((file) => (
              <View key={file.classwork_attachment_id} style={s.attachmentRow}>
                <Ionicons name="document-text-outline" size={18} color={AppColors.foreground} />
                <View style={{ flex: 1 }}>
                  <Text style={s.fileName} numberOfLines={1}>
                    {file.file_name}
                  </Text>
                  {file.file_size ? (
                    <Text style={s.fileSize}>
                      {(file.file_size / 1024).toFixed(0)} KB
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={() => handleRemoveExistingAttachment(file.classwork_attachment_id)}
                >
                  <Ionicons name="trash-outline" size={18} color={AppColors.destructive} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* New Attachments */}
        <View style={s.field}>
          <Text style={s.label}>Add More Files</Text>
          <TouchableOpacity style={s.fileButton} onPress={pickFile}>
            <Ionicons name="cloud-upload-outline" size={20} color={AppColors.foreground} />
            <Text style={s.fileButtonText}>Pick Files (4MB max)</Text>
          </TouchableOpacity>
          {newFiles.map((f, i) => (
            <View key={i} style={s.fileItem}>
              <Ionicons name="document-outline" size={16} color={AppColors.mutedForeground} />
              <Text style={s.fileName} numberOfLines={1}>
                {f.name}
              </Text>
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
            <Text style={s.saveButtonText}>Save Changes</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderBottomWidth: Borders.width,
    borderBottomColor: AppColors.border,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  form: { padding: Spacing.lg, gap: 20, paddingBottom: 40 },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  loadingHint: { fontSize: 14, color: AppColors.mutedForeground, fontWeight: '600' },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  input: {
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: AppColors.foreground,
    backgroundColor: AppColors.white,
    borderRadius: 6,
    ...NeoShadow.xs,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.white,
    borderRadius: 6,
  },
  chipActive: { backgroundColor: AppColors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: AppColors.foreground },
  chipTextActive: { color: AppColors.primaryForeground },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: AppColors.muted,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
    marginBottom: 6,
  },
  fileName: { flex: 1, fontSize: 13, fontWeight: '600', color: AppColors.foreground },
  fileSize: { fontSize: 11, color: AppColors.mutedForeground, marginTop: 2 },
  fileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderStyle: 'dashed',
    backgroundColor: AppColors.inputBackground,
    borderRadius: 6,
  },
  fileButtonText: { fontSize: 13, color: AppColors.mutedForeground, flex: 1 },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: AppColors.muted,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 6,
    marginBottom: 6,
  },
  saveButton: {
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 6,
    ...NeoShadow.md,
  },
  saveButtonText: { fontSize: 16, fontWeight: '900', color: AppColors.primaryForeground },
});
