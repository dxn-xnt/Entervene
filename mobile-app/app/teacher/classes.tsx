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
import InfoCard from "@/components/teacher/info-card";
import Badge from "@/components/badge";

export default function TeacherClassworks() {
  const { openDrawer } = useDrawer();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView>
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
              <Ionicons name="menu" size={24} color={AppColors.foreground} />
            </TouchableOpacity>

            <Text style={styles.title}>Classes</Text>
          </View>
        </View>
        <View style={styles.body}>
          {/* Subject container  */}
          <View style={styles.container}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Subject</Text>
              <TouchableOpacity>
                <Ionicons
                  name="arrow-forward"
                  size={24}
                  color={AppColors.foreground}
                />
              </TouchableOpacity>
            </View>
            <View style={styles.contentContainer}>
              <InfoCard
                title="Mathematics"
                stats={[
                  { icon: "", label: "Quizzes", count: 25 },
                  { icon: "", label: "Activities", count: 12 },
                ]}
              />
            </View>
          </View>
          {/* Classes container  */}
          <View style={styles.container}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Classes</Text>
              <TouchableOpacity>
                <Ionicons
                  name="arrow-forward"
                  size={24}
                  color={AppColors.foreground}
                />
              </TouchableOpacity>
            </View>
            <View style={styles.contentContainer}>
              <InfoCard
                title="7 - Sapphire"
                subtitle="Computer Programming"
                stats={[
                  { icon: "", label: "Assignments", count: 22 },
                  { icon: "", label: "Readings", count: 15 },
                ]}
              />
              <InfoCard
                title="7 - Sapphire"
                subtitle="Computer Programming"
                stats={[
                  { icon: "", label: "Assignments", count: 22 },
                  { icon: "", label: "Readings", count: 15 },
                ]}
              />
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
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 24,
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
