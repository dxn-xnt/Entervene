import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/hooks/api';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

export default function LessonView() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ lesson_id?: string }>();
  const [lesson, setLesson] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<number | null>(null);
  const API_URL = process.env.EXPO_PUBLIC_API_URL;

  useEffect(() => {
    if (!session?.token || !params.lesson_id) return;
    apiFetch(`/api/v1/lessons/${params.lesson_id}`, { token: session.token })
      .then(setLesson).catch((e) => Alert.alert('Error', e.message)).finally(() => setLoading(false));
  }, [params.lesson_id, session?.token]);

  const downloadFile = async (attId: number, fileName: string) => {
    setDownloading(attId);
    try {
      const url = `${API_URL}/api/v1/lessons/${params.lesson_id}/attachments/${attId}/download`;
      const fileUri = FileSystem.documentDirectory + fileName;
      const res = await FileSystem.downloadAsync(url, fileUri, { headers: { Authorization: `Bearer ${session!.token}` } });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(res.uri);
      else Alert.alert('Downloaded', `File saved to ${res.uri}`);
    } catch (e: any) { Alert.alert('Error', e.message); }
    setDownloading(null);
  };

  if (loading) return <SafeAreaView style={s.safe}><ActivityIndicator size="large" color={AppColors.primary} style={{ marginTop: 60 }} /></SafeAreaView>;
  if (!lesson) return <SafeAreaView style={s.safe}><Text style={s.errorText}>Not found</Text></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>Lesson</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>{lesson.title}</Text>
        <Text style={s.meta}>{lesson.subject_name} · by {lesson.teacher_name}</Text>
        {lesson.description ? <Text style={s.bodyText}>{lesson.description}</Text> : null}
        {lesson.content ? <View style={s.section}><Text style={s.sectionLabel}>Content</Text><Text style={s.bodyText}>{lesson.content}</Text></View> : null}
        {lesson.attachments.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Files</Text>
            {lesson.attachments.map((a: any) => (
              <TouchableOpacity key={a.lesson_attachment_id} style={s.fileRow} activeOpacity={0.7} onPress={() => downloadFile(a.lesson_attachment_id, a.file_name)}>
                <Ionicons name="download-outline" size={20} color={AppColors.primary} />
                <Text style={s.fileName} numberOfLines={1}>{a.file_name}</Text>
                {downloading === a.lesson_attachment_id && <ActivityIndicator size="small" color={AppColors.primary} />}
                <Text style={s.fileSize}>{(a.file_size / 1024).toFixed(0)} KB</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 14, borderBottomWidth: Borders.width, borderBottomColor: AppColors.border },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: AppColors.foreground },
  content: { padding: Spacing.lg, gap: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '900', color: AppColors.foreground },
  meta: { fontSize: 13, color: AppColors.mutedForeground },
  section: { gap: 8 },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: AppColors.foreground, textTransform: 'uppercase', letterSpacing: 0.5 },
  bodyText: { fontSize: 15, color: AppColors.foreground, lineHeight: 22 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderWidth: Borders.width, borderColor: AppColors.border, backgroundColor: AppColors.card, ...NeoShadow.xs },
  fileName: { flex: 1, fontSize: 14, fontWeight: '600', color: AppColors.foreground },
  fileSize: { fontSize: 11, color: AppColors.mutedForeground },
  errorText: { fontSize: 14, color: AppColors.destructive, textAlign: 'center', marginTop: 24 },
});
