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

import { AppColors, Spacing, Borders, NeoShadow } from "@/constants/theme";

import FormFooter from "@/components/teacher/form-footer";
import Card from "@/components/teacher/form-card";

export default function TeacherNewClassworks() {
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
              <Card
                key={item.id}
                label={item.label}
                icon={item.icon as keyof typeof Ionicons.glyphMap}
                onPress={() => router.push("/teacher/Forms/create-classwork-material")}
              />
            ))}
          </View>
          {/* cancel */}
          <FormFooter actions={[{ label: "Cancel", onPress: () => router.back() }]} />
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
    borderWidth: 2,
    borderRadius: 16,
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 12,
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
