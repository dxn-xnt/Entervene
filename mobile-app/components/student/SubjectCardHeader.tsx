import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AppColors, NeoShadow, Spacing } from '@/constants/theme';

type SubjectCardHeaderProps = {
  title: string;
  teacher: string;
  gradedCount?: string;
  label?: string;
  onPress?: () => void;
};

const SubjectCardHeader = ({
  title,
  teacher,
  gradedCount,
  label,
  onPress,
}: SubjectCardHeaderProps) => {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={styles.card}
    >
      <View style={styles.left}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.teacher}>{teacher}</Text>
      </View>
      {gradedCount !== undefined && (
        <View style={styles.right}>
          <Text style={styles.gradedCount}>{gradedCount}</Text>
          {label && <Text style={styles.label}>{label}</Text>}
        </View>
      )}
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

export default SubjectCardHeader;
