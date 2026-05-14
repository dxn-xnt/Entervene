import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '@/context/AuthContext';
import { apiUpload } from '@/hooks/api';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

interface FileInfo {
  uri: string;
  name: string;
  type: string;
  size: number;
  webFile?: Blob;
}

const MAX_FILE_SIZE = 4194304; // 4MB from schema constraint

export default function ClassworkSubmit() {
  const router = useRouter();
  const { session } = useAuth();
  const { assignmentId, classworkTitle } = useLocalSearchParams<{ assignmentId: string; classworkTitle: string }>();
  
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const pickFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['*/*'],
        multiple: true,
      });

      if (!result.canceled && result.assets) {
        const newFiles = result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || 'application/octet-stream',
          size: asset.size || 0,
          webFile: (asset as any).file as Blob | undefined,
        }));

        // Validate file sizes
        const invalidFiles = newFiles.filter((f) => f.size > MAX_FILE_SIZE);
        if (invalidFiles.length > 0) {
          Alert.alert(
            'File Size Error',
            `These files exceed 4MB limit:\n${invalidFiles.map((f) => f.name).join(', ')}`
          );
          return;
        }

        setFiles((prev) => [...prev, ...newFiles]);
      }
    } catch {
      Alert.alert('Error', 'Failed to pick files');
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const handleSubmit = async () => {
    if (files.length === 0) {
      Alert.alert('Error', 'Please select at least one file to submit');
      return;
    }

    if (!assignmentId) {
      Alert.alert('Error', 'Assignment ID not found');
      return;
    }

    setSubmitting(true);
    try {
      await apiUpload(
        `/api/v1/submissions/assignment/${assignmentId}/submit`,
        files.map(({ uri, name, type, webFile }) => ({ uri, name, type, webFile })),
        session!.token
      );
      Alert.alert('Success', `Submitted ${files.length} file(s)`);
      router.back();
    } catch (err: any) {
      Alert.alert('Submission Error', err.message || 'Failed to submit classwork');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={styles.headerTitle}>Submit Classwork</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.infoCard}>
          <Ionicons name="document-outline" size={24} color={AppColors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.classworkTitle}>{classworkTitle || 'Classwork'}</Text>
            <Text style={styles.hint}>Maximum file size: 4MB per file</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upload Files</Text>
          <TouchableOpacity
            style={styles.fileButton}
            onPress={pickFiles}
            disabled={submitting}
          >
            <Ionicons name="cloud-upload-outline" size={24} color={AppColors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.fileButtonText}>Tap to select files</Text>
              <Text style={styles.fileButtonSubtext}>
                {files.length} file(s) selected
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={AppColors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {files.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Selected Files</Text>
            {files.map((file, index) => (
              <View key={index} style={styles.fileItem}>
                <Ionicons name="document-outline" size={20} color={AppColors.foreground} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {file.name}
                  </Text>
                  <Text style={styles.fileSize}>{formatFileSize(file.size)}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => removeFile(index)}
                  disabled={submitting}
                  style={{ padding: 4 }}
                >
                  <Ionicons name="close-circle" size={20} color={AppColors.destructive} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.submitButton,
            (submitting || files.length === 0) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={submitting || files.length === 0}
        >
          {submitting ? (
            <ActivityIndicator color={AppColors.primaryForeground} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color={AppColors.primaryForeground} />
              <Text style={styles.submitButtonText}>Submit Assignment</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderBottomWidth: Borders.width,
    borderBottomColor: AppColors.border,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  content: { padding: Spacing.md, gap: 20, paddingBottom: 40 },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: AppColors.muted,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 8,
  },
  classworkTitle: { fontSize: 16, fontWeight: '700', color: AppColors.foreground },
  hint: { fontSize: 12, color: AppColors.mutedForeground, marginTop: 4 },
  section: { gap: 12 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: AppColors.foreground,
    marginBottom: 4,
  },
  fileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 2,
    borderColor: AppColors.primary,
    borderRadius: 8,
    borderStyle: 'dashed',
    backgroundColor: AppColors.inputBackground,
  },
  fileButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: AppColors.foreground,
  },
  fileButtonSubtext: {
    fontSize: 12,
    color: AppColors.mutedForeground,
    marginTop: 2,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
    backgroundColor: AppColors.inputBackground,
    marginBottom: 8,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '500',
    color: AppColors.foreground,
  },
  fileSize: {
    fontSize: 12,
    color: AppColors.mutedForeground,
    marginTop: 2,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    marginTop: 8,
    ...NeoShadow.md,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: AppColors.primaryForeground,
  },
});
