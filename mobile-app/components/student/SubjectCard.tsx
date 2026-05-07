import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AppColors, NeoShadow, Spacing } from '@/constants/theme';

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

const SubjectCard = ({ title, teacher, quarter, badges = [], onPress }: SubjectCardProps) => {
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.card}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {quarter ? (
          <View style={styles.quarterBadge}>
            <Text style={styles.quarterText}>{quarter}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.teacher}>{teacher}</Text>
      {badges.length > 0 && (
        <View style={styles.badgeRow}>
          {badges.map((badge) => (
            <View key={badge.label} style={styles.badge}>
              <Text style={styles.badgeText}>
                {badge.label} {badge.count}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 2,
    borderColor: AppColors.border,
    borderRadius: 8,
    padding: Spacing.md,
    backgroundColor: AppColors.card,
    shadowColor: AppColors.black,
    ...NeoShadow.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  quarterBadge: {
    backgroundColor: AppColors.muted,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  quarterText: {
    fontSize: 10,
    fontWeight: '700',
    color: AppColors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  teacher: {
    fontSize: 13,
    color: AppColors.mutedForeground,
    marginTop: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  badge: {
    borderWidth: 1,
    borderColor: '#facc15',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    color: '#ca8a04',
  },
});

export default SubjectCard;
