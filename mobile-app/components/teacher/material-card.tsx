import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppColors } from "@/constants/theme";

interface MaterialCardProps {
  filename: string;
  fileType: string;
  onRemove?: () => void;
}

export default function MaterialCard({ filename, fileType, onRemove }: MaterialCardProps) {
  return (
    <View style={styles.card}>
      {onRemove && (
        <TouchableOpacity style={styles.deleteButton} onPress={onRemove}>
          <Ionicons name="trash-outline" size={18} color={AppColors.black} />
        </TouchableOpacity>
      )}
      <Text style={styles.fileType}>{fileType}</Text>
      <View style={styles.footer}>
        <Text style={styles.filename} numberOfLines={1}>{filename}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 120,
    height: 120,
    borderWidth: 1.5,
    borderRadius: 12,
    borderColor: AppColors.black,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: AppColors.background,
  },
  deleteButton: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppColors.black,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: AppColors.background,
  },
  fileType: {
    fontSize: 14,
    fontWeight: "500",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#7ABA78",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  filename: {
    fontSize: 12,
    fontWeight: "500",
  },
});