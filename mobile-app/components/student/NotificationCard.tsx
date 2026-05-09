import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AppColors, NeoShadow, Spacing } from '@/constants/theme';

type NotificationCardProps = {
  title: string;
  description: string;
  cardInfo: string;
  badge: string;
};

const NotificationCard = ({
  title,
  description,
  cardInfo,
  badge,
}: NotificationCardProps) => {
  return (
    <View style={styles.card}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description} numberOfLines={2}>
          {description}
        </Text>
        <Text style={styles.cardInfo}>{cardInfo}</Text>
      </View>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{badge}</Text>
      </View>
    </View>
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
    backgroundColor: AppColors.card,
    shadowColor: AppColors.black,
    ...NeoShadow.lg,
  },
  content: {
    flex: 1,
    gap: 6,
    marginRight: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  description: {
    fontSize: 13,
    color: AppColors.foreground,
    lineHeight: 18,
  },
  cardInfo: {
    fontSize: 11,
    color: AppColors.mutedForeground,
  },
  badge: {
    backgroundColor: AppColors.accent,
    borderWidth: 2,
    borderColor: AppColors.border,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: AppColors.foreground,
  },
});

export default NotificationCard;
