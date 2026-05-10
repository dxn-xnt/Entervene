import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { AppColors } from "@/constants/theme";

interface FilterChipProps {
  label: string;
  onRemove?: () => void;
}

export default function FilterChip({ label, onRemove }: FilterChipProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onRemove}>
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: 16,
    paddingHorizontal: 34,
    backgroundColor: "#7ABA78",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.black,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
  },
});