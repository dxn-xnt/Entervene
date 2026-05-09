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
  badges: Badge[];
  onPress?: () => void;
};

const SubjectCard = ({ title, teacher, badges, onPress }: SubjectCardProps) => {
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.card}
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.teacher}>{teacher}</Text>
      <View style={styles.badgeRow}>
        {badges.map((badge) => (
          <View key={badge.label} style={styles.badge}>
            <Text style={styles.badgeText}>
              {badge.label} {badge.count}
            </Text>
          </View>
        ))}
      </View>
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
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  teacher: {
    fontSize: 13,
    color: AppColors.mutedForeground,
    marginTop: 2,
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
