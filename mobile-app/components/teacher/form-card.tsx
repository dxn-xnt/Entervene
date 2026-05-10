import React from "react";
import { TouchableOpacity, Text, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppColors } from "@/constants/theme";

interface ClassworkTypeCardProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
  onPress: () => void;
}

export default function ClassworkTypeCard({
  label,
  icon,
  description,
  onPress,
}: ClassworkTypeCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.row}>
        <Ionicons name={icon} size={24} color={AppColors.black} />
        <Text style={styles.cardLabel}>{label}</Text>
      </View>
      <Text style={styles.description}>{description}</Text>
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
    gap: 6,
    backgroundColor: "#7ABA78",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  description: {
    fontSize: 12,
    color: AppColors.black,
  },
});
