import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  // RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useDrawer } from "@/context/DrawerContext";
import { AppColors, Spacing, Borders, NeoShadow } from "@/constants/theme";
// import { useRouter } from "@/.expo/types/router";

export default function TeacherDashboard() {
  const { openDrawer } = useDrawer();

  //   const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView>
        <View style={styles.header}>
          <TouchableOpacity onPress={openDrawer} activeOpacity={0.7}>
            <Ionicons name="menu" size={24} color={AppColors.foreground} />
          </TouchableOpacity>

          <Text style={styles.title}>Dashboard</Text>
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  gridItem: { width: "100%" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: Borders.width,
    borderBottomColor: AppColors.border,
  },
  textHeader: {
    fontSize: 32,
    fontWeight: "bold",
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

  classActivityHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  activityCardContainer: {
    flexDirection: "column",
    gap: 16,
  },
  activityCard: {
    backgroundColor: AppColors.background,
    borderWidth: 2,
    borderColor: AppColors.border,
    borderRadius: 4,
    padding: 16,

    flexDirection: "column",
    gap: 4,
  },

  container: {
    borderWidth: 2,
    borderColor: AppColors.border,
    borderRadius: 8,

    padding: 16,
    backgroundColor: AppColors.background,
    shadowColor: AppColors.black,
    ...NeoShadow.lg,
  },
  performanceRateHeader: {
    flexDirection: "column",
    gap: 8,
  },
  filterRow: { flexDirection: "row", gap: 10 },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minWidth: 130,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: AppColors.border,
    borderRadius: 8,
    backgroundColor: AppColors.background,
  },
  filterText: { fontSize: 14, fontWeight: "500", color: AppColors.foreground },
  contentContainer: { paddingBottom: 32 },
});
