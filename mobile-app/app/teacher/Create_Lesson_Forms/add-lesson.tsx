import React from "react";
import { router } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { AppColors, NeoShadow } from "@/constants/theme";
import FormFooter from "@/components/teacher/form-footer";
import Card from "@/components/teacher/form-card";

const ADDING_TYPES = [
  {
    id: "import",
    label: "Import from file",
    icon: "book-outline",
    description: "Upload a CSV or Excel file to add multiple lessons at once",
  },
  {
    id: "manual",
    label: "Create manually",
    icon: "help-circle-outline",
    description: "Add individual lessons one at a time",
  },
] as const;
export default function TeacherAddLesson() {
  const handleCardPress = (type: string) => {
    if (type === "manual") {
      router.push("/teacher/Create_Lesson_Forms/manual-creation");
    } else {
      router.push("/teacher/Create_Lesson_Forms/upload-file");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={{ fontSize: 24 }}>Add new lessons</Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="close" size={24} color={AppColors.black} />
            </TouchableOpacity>
          </View>
          <View style={styles.cardGrid}>
            {ADDING_TYPES.map((item) => (
              <Card
                key={item.id}
                label={item.label}
                icon={item.icon as keyof typeof Ionicons.glyphMap}
                description={item.description}
                onPress={() => handleCardPress(item.id)}
              />
            ))}
          </View>
          <FormFooter
            actions={[{ label: "Cancel", onPress: () => router.back() }]}
          />
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
    flex: 1,
    flexDirection: "column",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 12,
  },
});
