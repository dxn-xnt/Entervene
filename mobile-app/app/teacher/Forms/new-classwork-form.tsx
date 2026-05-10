import React from "react";
import { router } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { AppColors, NeoShadow } from "@/constants/theme";
import FormFooter from "@/components/teacher/form-footer";
import Card from "@/components/teacher/form-card";

const CLASSWORK_TYPES = [
  {
    id: "reading",
    label: "Reading",
    icon: "book-outline",
    description: "Create and publish class topics or resources for learners",
  },
  {
    id: "quiz",
    label: "Quiz",
    icon: "help-circle-outline",
    description: "Build and assign quizzes to assess learner understanding",
  },
  {
    id: "assignment",
    label: "Assignment",
    icon: "desktop-outline",
    description: "Post tasks or projects for students to complete and submit",
  },
  {
    id: "activity",
    label: "Activity",
    icon: "hourglass-outline",
    description: "Design interactive tasks to enhance learner engagement",
  },
] as const;

export default function TeacherNewClassworks() {
  const handleCardPress = (type: string) => {
    router.push({
      pathname: "/teacher/Forms/create-classwork-material",
      params: { type },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={{ fontSize: 24 }}>Create new classwork</Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="close" size={24} color={AppColors.black} />
            </TouchableOpacity>
          </View>
          <View style={styles.cardGrid}>
            {CLASSWORK_TYPES.map((item) => (
              <Card
                key={item.id}
                label={item.label}
                icon={item.icon as keyof typeof Ionicons.glyphMap}
                description={item.description}
                onPress={() => handleCardPress(item.id)}
              />
            ))}
          </View>

          {/* Footer */}
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
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 12,
  },
});
