import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppColors, NeoShadow, Spacing, Borders } from '@/constants/theme';

// Status colour map
const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  submitted: { bg: '#bfdbfe', text: '#1d4ed8', label: 'Submitted' },
  graded: { bg: '#bbf7d0', text: '#15803d', label: 'Graded' },
  late: { bg: '#fecaca', text: '#b91c1c', label: 'Late' },
  pending: { bg: '#fef08a', text: '#854d0e', label: 'Pending' },
  missing: { bg: '#fee2e2', text: '#b91c1c', label: 'Missing' },
};

type ClassworkItemProps = {
  title: string;
  submittedDate: string;
  status?: string | null;
  onPress?: () => void;
};

const ClassworkItem = ({ title, submittedDate, status, onPress }: ClassworkItemProps) => {
  const key = (status ?? 'missing').toLowerCase();
  const badge = STATUS_STYLES[key] ?? STATUS_STYLES['missing'];
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper onPress={onPress} activeOpacity={0.8} style={styles.card}>
      <View style={styles.left}>
        <View style={styles.iconWrap}>
          <Ionicons name="document-text-outline" size={18} color={AppColors.foreground} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          <Text style={styles.sub}>{submittedDate}</Text>
        </View>
      </View>

      <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
        <Text style={[styles.statusText, { color: badge.text }]}>{badge.label}</Text>
      </View>
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 10,
    backgroundColor: AppColors.card,
    gap: 10,
    ...NeoShadow.sm,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 34, height: 34,
    borderRadius: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.muted,
    justifyContent: 'center', alignItems: 'center',
  },
  textCol: { flex: 1, gap: 3 },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: AppColors.foreground,
    flexShrink: 1,
  },
  sub: {
    fontSize: 11,
    color: AppColors.mutedForeground,
  },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6,
    flexShrink: 0,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

export default ClassworkItem;
