import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { AppColors, NeoShadow, Borders } from "@/constants/theme";
import Badge from "@/components/badge";

interface BadgeItem {
  label: string;
}

interface ClassworkCardProps {
  title: string;
  createdAt: string;
  badges?: BadgeItem[];
  onPress?: () => void;
}

export default function ClassworkCard({
  title,
  createdAt,
  badges = [],
  onPress,
}: ClassworkCardProps) {
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper onPress={onPress} activeOpacity={0.8} style={styles.card}>
      {/* Title row */}
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>

      {/* Date */}
      <Text style={styles.date}>{createdAt}</Text>

      {/* Badges */}
      {badges.length > 0 && (
        <View style={styles.badgeRow}>
          {badges.map((b, i) => (
            <Badge key={i} label={b.label} />
          ))}
        </View>
      )}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 10,
    backgroundColor: AppColors.card,
    shadowColor: AppColors.black,
    ...NeoShadow.sm,
    gap: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: AppColors.foreground,
    flexShrink: 1,
    lineHeight: 22,
  },
  date: {
    fontSize: 12,
    color: AppColors.mutedForeground,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
});