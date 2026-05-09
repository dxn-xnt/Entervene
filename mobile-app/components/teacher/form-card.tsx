import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppColors } from "@/constants/theme";

interface ClassworkTypeCardProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

export default function ClassworkTypeCard({ label, icon, onPress }: ClassworkTypeCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <Ionicons name={icon} size={28} color={AppColors.black} />
      <Text style={styles.cardLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "47%",
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 10,
    borderColor: AppColors.black,
    // justifyContent: "center",
    // alignItems: "center",
    gap: 8,
    backgroundColor: "#7ABA78",
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
});