import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { AppColors, NeoShadow } from "@/constants/theme";
import Badge from "@/components/badge";

interface BadgeItem {
  label: string;
}

interface ClassworkCardProps {
  title: string;
  createdAt: string;
  badges?: BadgeItem[];
}

export default function ClassworkCard({ title, createdAt, badges = [] }: ClassworkCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <Text style={styles.cardText}>{title}</Text>
        <Text>{createdAt}</Text>
      </View>
      {badges.length > 0 && (
        <View style={styles.cardBadge}>
          {badges.map((b, i) => (
            <Badge key={i} label={b.label} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 8,
    backgroundColor: AppColors.background,
    shadowColor: AppColors.black,
    ...NeoShadow.lg,
  },
  cardContent: {
    flex: 1,
    flexDirection: "column",
    gap: 6,
  },
  cardBadge: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    gap: 8,
    marginTop: "auto",
  },
  cardText: {
    fontSize: 24,
    fontWeight: "bold",
    color: AppColors.foreground,
  },
});