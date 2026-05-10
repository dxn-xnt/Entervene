import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { AppColors, NeoShadow } from "@/constants/theme";
import { Ionicons } from "@expo/vector-icons";

interface AddButtonProps {
  onPress: () => void;
}

export default function AddButton({ onPress }: AddButtonProps) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress}>
      <Ionicons name="add" size={24} color={AppColors.black} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 50,
    height: 45,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: AppColors.black,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: AppColors.background,
  },
  icon: {
    fontSize: 24,
    fontWeight: "300",
    color: AppColors.black,
  },
});