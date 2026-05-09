import React, { useState } from "react";
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

export default function TeacherNewClassworks() {
  const { openDrawer } = useDrawer();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        {/* container */}
        <View style={styles.container}>
          {/* header */}
          <View style={styles.header}>
            <Text style={{ fontSize: 24 }}>Create new classwork</Text>
            <TouchableOpacity>X</TouchableOpacity>
          </View>
          {/* card container */}
          <View style={styles.cardGrid}>
            {[
              { id: 1, label: "Assignment", icon: "document-text-outline" },
              { id: 2, label: "Quiz", icon: "help-circle-outline" },
              { id: 3, label: "Material", icon: "book-outline" },
              { id: 4, label: "Question", icon: "chatbubble-outline" },
            ].map((item) => (
              <TouchableOpacity key={item.id} style={styles.card}>
                <Ionicons
                  name={item.icon as any}
                  size={28}
                  color={AppColors.black}
                />
                <Text style={styles.cardLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* cancel */}
          <View style={styles.bottomContainer}>
            <TouchableOpacity style={styles.cancelBtn}>
              <Text>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  container: {
    padding: 20,
    borderWidth: 2,
    borderRadius: 12,
    shadowColor: AppColors.black,
    ...NeoShadow.lg,
    width: "100%",
    gap: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 2,
    paddingBottom: 12,
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  card: {
    width: "47%",
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 10,
    borderColor: AppColors.black,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#7ABA78",
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  bottomContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    borderTopWidth: 2,
    paddingTop: 12,
  },
  cancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
});
