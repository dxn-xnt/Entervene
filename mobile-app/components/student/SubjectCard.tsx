import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AppColors, NeoShadow, Spacing, Borders } from '@/constants/theme';

type Badge = {
  label: string;
  count: number;
};

type SubjectCardProps = {
  title: string;
  teacher: string;
  quarter?: string;
  badges?: Badge[];
  onPress?: () => void;
};

// Colour presets keyed by classwork type keywords
function getBadgeColor(label: string): { bg: string; text: string; border: string } {
  const l = label.toLowerCase();
  if (l.includes('quiz'))       return { bg: '#fecaca', text: '#991b1b', border: '#fca5a5' };
  if (l.includes('assignment')) return { bg: '#fef08a', text: '#854d0e', border: '#fde047' };
  if (l.includes('activity'))   return { bg: '#bbf7d0', text: '#166534', border: '#86efac' };
  if (l.includes('reading'))    return { bg: '#fef08a', text: '#854d0e', border: '#fde047' };
  if (l.includes('all done') || l.includes('completed'))
                                 return { bg: '#bbf7d0', text: '#166534', border: '#86efac' };
  return { bg: AppColors.muted, text: AppColors.mutedForeground, border: AppColors.border };
}

const SubjectCard = ({ title, teacher, badges = [], onPress }: SubjectCardProps) => {
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper onPress={onPress} activeOpacity={0.8} style={styles.card}>
      <Text style={styles.title} numberOfLines={2}>{title}</Text>
      <Text style={styles.teacher} numberOfLines={1}>{teacher}</Text>

      {badges.length > 0 && (
        <View style={styles.badgeRow}>
          {badges.map((badge, i) => {
            const colors = getBadgeColor(badge.label);
            return (
              <View
                key={i}
                style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}
              >
                <Text style={[styles.badgeText, { color: colors.text }]}>{badge.label}</Text>
              </View>
            );
          })}
        </View>
      )}
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 10,
    padding: Spacing.md,
    backgroundColor: AppColors.card,
    shadowColor: AppColors.black,
    ...NeoShadow.md,
    gap: 4,
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: AppColors.foreground,
    lineHeight: 22,
  },
  teacher: {
    fontSize: 12,
    color: AppColors.mutedForeground,
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

export default SubjectCard;
