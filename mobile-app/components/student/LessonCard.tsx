import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AppColors, NeoShadow, Spacing } from '@/constants/theme';

type LessonCardProps = {
  lessonTitle: string;
  scheduledDate: string;
  onPress?: () => void;
};

const LessonCard = ({
  lessonTitle,
  scheduledDate,
  onPress,
}: LessonCardProps) => {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={styles.card}
    >
      <View style={styles.left}>
        <Text style={styles.title}>{lessonTitle}</Text>
        <Text style={styles.teacher}>{scheduledDate}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: AppColors.border,
    borderRadius: 8,
    backgroundColor: '#F6E9B2',
    shadowColor: AppColors.black,
    ...NeoShadow.lg,
  },
  left: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  teacher: {
    fontSize: 13,
    color: AppColors.foreground,
  },
  right: {
    alignItems: 'flex-end',
  },
  gradedCount: {
    fontSize: 22,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  label: {
    fontSize: 12,
    color: AppColors.foreground,
  },
});

export default LessonCard;
