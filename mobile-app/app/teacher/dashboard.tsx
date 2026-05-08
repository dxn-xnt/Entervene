import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useDrawer } from "@/context/DrawerContext";
import { AppColors, Spacing, Borders } from "@/constants/theme";

export default function TeacherClasses() {
  const { openDrawer } = useDrawer();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
          <Ionicons name="menu" size={24} color={AppColors.foreground} />
        </TouchableOpacity>
        <Text style={styles.title}>Dashboard</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.placeholder}>Classes</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: Borders.width,
    borderBottomColor: AppColors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: AppColors.foreground,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholder: {
    fontSize: 24,
    fontWeight: "700",
    color: AppColors.mutedForeground,
  },
});
