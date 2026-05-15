import React, { useState } from "react";
import { router } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useDrawer } from "@/context/DrawerContext";
import { AppColors, Spacing, Borders, NeoShadow } from "@/constants/theme";
import TabBar from "@/components/student/TabBar";
import ClassworkCard from "@/components/classwork-card";
import { useTeacherClassworks } from "@/hooks/useTeacherData";

const TABS = [
  { id: "all",        label: "All" },
  { id: "ASSIGNMENT", label: "Assignments" },
  { id: "ACTIVITY",   label: "Activities" },
  { id: "QUIZ",       label: "Quizzes" },
];

export default function TeacherClassworks() {
  const { openDrawer } = useDrawer();
  const [activeTab, setActiveTab] = useState("all");
  const { classworks, isLoading, error, refresh } = useTeacherClassworks();

  const filtered =
    activeTab === "all"
      ? classworks
      : classworks.filter((c) => c.classwork_type === activeTab);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
              <Ionicons name="menu" size={24} color={AppColors.foreground} />
            </TouchableOpacity>
            <Text style={styles.title}>Classworks</Text>
          </View>
          <TouchableOpacity
            onPress={() =>
              router.push("/teacher/Create_Classwork_Forms/new-classwork-form")
            }
          >
            <Text style={styles.newClassworkButton}>+ New Classwork</Text>
          </TouchableOpacity>
        </View>

        <TabBar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

        {/* ── Body ── */}
        <View style={styles.body}>
          {isLoading ? (
            <ActivityIndicator
              size="large"
              color={AppColors.foreground}
              style={{ marginTop: 40 }}
            />
          ) : error ? (
            <View style={styles.centerBox}>
              <Text style={styles.emptyText}>Failed to load classworks.</Text>
              <TouchableOpacity onPress={refresh} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.centerBox}>
              <Ionicons
                name="document-text-outline"
                size={42}
                color={AppColors.mutedForeground}
              />
              <Text style={styles.emptyText}>No classworks yet.</Text>
              <Text style={styles.emptyHint}>
                Tap New Classwork to create one.
              </Text>
            </View>
          ) : (
            filtered.map((cw) => (
              <ClassworkCard
                key={cw.classwork_id}
                title={cw.title}
                createdAt={`Created ${new Date(cw.created_at).toLocaleDateString(
                  "en-US",
                  { month: "long", day: "numeric", year: "numeric" }
                )}`}
                badges={[
                  { label: cw.classwork_type },
                  ...(cw.classwork_category
                    ? [{ label: cw.classwork_category }]
                    : []),
                  ...(cw.subject_name ? [{ label: cw.subject_name }] : []),
                ]}
                onPress={() =>
                  router.push({
                    pathname: "/teacher/classwork-detail" as any,
                    params: { classwork_id: cw.classwork_id },
                  })
                }
              />
            ))
          )}
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
    paddingBottom: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.muted,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: AppColors.foreground,
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
  body: {
    flex: 1,
    padding: 16,
    gap: 20,
  },
  centerBox: {
    alignItems: "center",
    paddingTop: 48,
    gap: 10,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: "600",
    color: AppColors.mutedForeground,
  },
  emptyHint: {
    fontSize: 13,
    color: AppColors.mutedForeground,
  },
  retryBtn: {
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
  },
  retryText: {
    fontSize: 14,
    fontWeight: "600",
    color: AppColors.foreground,
  },
});
