import React, { useState } from "react";
import { router } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useDrawer } from "@/context/DrawerContext";
import { AppColors, Spacing, Borders, NeoShadow } from "@/constants/theme";
import Card from "@/components/card";

export default function TeacherClassesSubject() {
  const { openDrawer } = useDrawer();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView>
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
              <Ionicons name="menu" size={24} color={AppColors.foreground} />
            </TouchableOpacity>

            <Text style={styles.title}>Subject</Text>
          </View>
        </View>
        <View style={styles.body}>
          <Card title="Mathematics" subtitle="25 quizzes, 12 activities" onPress={() => router.push({ pathname: "/teacher/subject-detail", params: { title: "Mathematics" } })} />
        </View>
      </ScrollView>
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
    justifyContent: "space-between",
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
    padding: 16,
    gap: 20,
  },
});
