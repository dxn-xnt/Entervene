import React from "react";
import { TouchableOpacity, StyleSheet } from "react-native";
import { AppColors } from "@/constants/theme";
import { Ionicons } from "@expo/vector-icons";

interface AddButtonProps {
  onPress: () => void;
  /** Match material card height when used beside file previews */
  size?: "default" | "large";
}

export default function AddButton({ onPress, size = "default" }: AddButtonProps) {
  const dim = size === "large" ? 120 : 50;
  const h = size === "large" ? 120 : 45;
  return (
    <TouchableOpacity
      style={[styles.button, { width: dim, height: h }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Ionicons name="add" size={24} color={AppColors.black} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderRadius: 12,
    borderColor: AppColors.black,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: AppColors.background,
  },
});