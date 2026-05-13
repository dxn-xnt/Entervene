import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useAssignmentSubmissions } from '@/hooks/useSubmissions';
import { apiFetch } from '@/hooks/api';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

export default function GradeSubmission() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ submission_id?: string; student_name?: string; classwork_title?: string; total_points?: string }>();
  const [grade, setGrade] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  const handleGrade = async () => {
    if (!grade.trim()) { Alert.alert('Error', 'Enter a grade'); return; }
    setSaving(true);
    try {
      await apiFetch(`/api/v1/submissions/${params.submission_id}/grade`, { method: 'PUT', token: session!.token, body: JSON.stringify({ grade: parseFloat(grade), feedback }) });
      Alert.alert('Success', 'Grade submitted!'); router.back();
    } catch (e: any) { Alert.alert('Error', e.message); } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backRow}>
          <Ionicons name="chevron-back" size={24} color={AppColors.foreground} />
          <Text style={s.headerTitle}>Grade Submission</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <View style={s.infoCard}>
          <Text style={s.infoLabel}>Student</Text>
          <Text style={s.infoValue}>{params.student_name || 'Unknown'}</Text>
          <Text style={s.infoLabel}>Classwork</Text>
          <Text style={s.infoValue}>{params.classwork_title || ''}</Text>
        </View>
        <View style={s.field}>
          <Text style={s.label}>Grade (out of {params.total_points || '100'})</Text>
          <TextInput style={s.input} value={grade} onChangeText={setGrade} keyboardType="numeric" placeholder="e.g. 85" placeholderTextColor={AppColors.placeholder} />
        </View>
        <View style={s.field}>
          <Text style={s.label}>Feedback</Text>
          <TextInput style={[s.input, s.textArea]} value={feedback} onChangeText={setFeedback} placeholder="Optional feedback for student..." multiline numberOfLines={4} placeholderTextColor={AppColors.placeholder} />
        </View>
        <TouchableOpacity style={[s.saveButton, saving && { opacity: 0.7 }]} onPress={handleGrade} disabled={saving} activeOpacity={0.8}>
          {saving ? <ActivityIndicator color={AppColors.primaryForeground} /> : <Text style={s.saveButtonText}>Submit Grade</Text>}
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
  infoCard: { padding: 16, borderWidth: Borders.width, borderColor: AppColors.border, backgroundColor: AppColors.accent, gap: 4 },
  infoLabel: { fontSize: 12, fontWeight: '600', color: AppColors.mutedForeground },
  infoValue: { fontSize: 16, fontWeight: '700', color: AppColors.foreground, marginBottom: 8 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  input: { borderWidth: Borders.width, borderColor: AppColors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: AppColors.foreground, backgroundColor: AppColors.white, ...NeoShadow.xs },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  saveButton: { backgroundColor: AppColors.primary, borderWidth: Borders.width, borderColor: AppColors.border, paddingVertical: 14, alignItems: 'center', ...NeoShadow.md },
  saveButtonText: { fontSize: 16, fontWeight: '900', color: AppColors.primaryForeground },
});
