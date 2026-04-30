import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppColors, NeoShadow, Spacing } from '@/constants/theme';

type ToDoItemProps = {
  title: string;
  subject: string;
  deadline: string;
};

const ToDoItem = ({ title, subject, deadline }: ToDoItemProps) => {
  return (
    <View style={styles.card}>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Ionicons name="document-text-outline" size={22} color={AppColors.foreground} />
          <Text style={styles.title}>{title}</Text>
        </View>
        <Text style={styles.subtitle}>
          {subject} | Deadline {deadline}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: AppColors.border,
    borderRadius: 8,
    backgroundColor: '#FFFDF5',
    shadowColor: AppColors.black,
    ...NeoShadow.lg,
  },
  content: {
    flex: 1,
    gap: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  subtitle: {
    fontSize: 13,
    color: AppColors.mutedForeground,
  },
});

export default ToDoItem;
