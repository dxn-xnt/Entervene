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
import TabBar from "@/components/TabBar";
import ToDoItem from "@/components/To-Do";
// import { useRouter } from "@/.expo/types/router";

const todoTabs = [
  { id: "all", label: "All" },
  { id: "readings", label: "Readings" },
  { id: "activities", label: "Activities" },
  { id: "assignments", label: "Assignments" },
  { id: "quizzes", label: "Quizzes" },
];

export default function TeacherClassworks() {
  const { openDrawer } = useDrawer();
  const [activeTab, setActiveTab] = useState("all");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        // refreshControl={
        //   <RefreshControl refreshing={isLoading} onRefresh={refresh} />
        // }
      >
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
              <Ionicons name="menu" size={24} color={AppColors.foreground} />
            </TouchableOpacity>

            <Text style={styles.title}>Classworks</Text>
          </View>
          <TouchableOpacity
              onPress={() => router.push("/teacher/new-classwork-form")}
            >
              <Text style={styles.newClassworkButton}>+ New Classwork</Text>
            </TouchableOpacity>
        </View>
        <TabBar tabs={todoTabs} activeTab={activeTab} onChange={setActiveTab} />
        <View style={styles.body}>
          <View style={styles.card}>
            <View style={styles.cardContent}>
              <Text style={styles.cardText}>Coding Activity</Text>
              <Text>Created October 30, 2025</Text>
            </View>
            <View style={styles.cardBadge}>
              <View style={styles.badge}>
                <Text>Badge 1</Text>
              </View>
              <View style={styles.badge}>
                <Text>Badge 2</Text>
              </View>
            </View>
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
  contentContainer: { paddingBottom: 32 },
  container: {
    borderWidth: 2,
    borderColor: AppColors.border,
    borderRadius: 8,

    padding: 16,
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
  newClassworkButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#7ABA78",
    borderWidth: 1,
    borderRadius: 8,
    shadowColor: AppColors.black,
    ...NeoShadow.lg,
  },
  cardText: {
    fontSize: 24,
    fontWeight: "bold",
    color: AppColors.foreground,
  },
  card: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderWidth: 2,
    borderColor: AppColors.border,
    borderRadius: 8,
    backgroundColor: AppColors.background,
  },
  cardContent: {
    flex: 1,
    flexDirection: "column",
    gap: 6,
  },
  cardBadge: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    gap: 8,
    marginTop: "auto",
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: "#7ABA78",
    borderRadius: 24,
  }
});
