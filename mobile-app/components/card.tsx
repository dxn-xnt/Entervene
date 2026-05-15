import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { AppColors, NeoShadow } from "@/constants/theme";

interface InfoCardProps {
  title: string;
  subtitle: string;
  onPress?: () => void;
}

export default function InfoCard({ title, subtitle, onPress }: InfoCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 8,
    borderColor: AppColors.black,
    backgroundColor: "#fff",
    ...NeoShadow.lg,
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 12,
    color: "#555",
  },
});
