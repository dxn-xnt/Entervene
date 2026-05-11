import React, { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
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
import TabBar from "@/components/TabBar";
import StatCard from "@/components/overview-card";

export default function TeacherSubjectDetail() {
  const { openDrawer } = useDrawer();
  const { title } = useLocalSearchParams<{ title: string }>();
  const [activeTab, setActiveTab] = useState("lesson");

  const todoTabs = [
    { id: "lesson", label: "Lesson" },
    { id: "classwork", label: "Classwork" },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView>
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
              <Ionicons name="menu" size={24} color={AppColors.foreground} />
            </TouchableOpacity>

            <Text style={styles.title} onPress={() => router.back()}>
              Subject &gt; {title}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/teacher/Create_Lesson_Forms/add-lesson")}
          >
            <Text style={styles.newLessonButton}>+ Add Lesson</Text>
          </TouchableOpacity>
        </View>
        <TabBar tabs={todoTabs} activeTab={activeTab} onChange={setActiveTab} />
        <View style={styles.body}>
          <Text style={styles.title}>Subject Overview</Text>
          {/* overview card container */}
          <View style={styles.overviewCardContainer}>
            <StatCard label="Lesson Mastery" value={25} change="12" />
            <StatCard label="Classwork Assigned" value={25} change="12" />
            <StatCard label="Completion Percentage" value={25} change="12" />
          </View>
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
  contentContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  container: {
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 8,

    padding: 12,
    gap: 12,
    backgroundColor: AppColors.background,
    shadowColor: AppColors.black,
    ...NeoShadow.lg,
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
  overviewCardContainer: {
    flexDirection: "column",
    gap: 12,
  },
  newLessonButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#7ABA78",
    borderWidth: 1,
    borderRadius: 8,
    shadowColor: AppColors.black,
    ...NeoShadow.lg,
  }
});
