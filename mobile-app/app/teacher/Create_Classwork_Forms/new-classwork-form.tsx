import React from "react";
import { router } from "expo-router";
import { View, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ClassworkUi } from "@/constants/classwork-ui";
import FormFooter from "@/components/teacher/form-footer";
import Card from "@/components/teacher/form-card";
import ClassworkModalShell from "@/components/teacher/classwork-modal-shell";

const CLASSWORK_TYPES = [
  {
    id: "reading",
    label: "Reading",
    icon: "book-outline" as const,
    description: "Create and publish class topics or resources for learners",
  },
  {
    id: "quiz",
    label: "Quiz",
    icon: "create-outline" as const,
    description: "Build and assign quizzes to assess learner understanding",
  },
  {
    id: "assignment",
    label: "Assignment",
    icon: "library-outline" as const,
    description: "Post tasks or projects for students to complete and submit",
  },
  {
    id: "activity",
    label: "Activity",
    icon: "hourglass-outline" as const,
    description: "Design interactive tasks to enhance learner engagement",
  },
] as const;

export default function TeacherNewClassworks() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.page}>
        <ClassworkModalShell
          title="Create new classwork"
          onClose={() => router.back()}
          footer={
            <FormFooter
              actions={[{ label: "Cancel", onPress: () => router.back() }]}
            />
          }
        >
          <View style={styles.cardGrid}>
            {CLASSWORK_TYPES.map((item) => (
              <Card
                key={item.id}
                label={item.label}
                icon={item.icon}
                description={item.description}
                onPress={() =>
                  router.push({
                    pathname: "/teacher/Create_Classwork_Forms/create-classwork-material",
                    params: { type: item.id },
                  })
                }
              />
            ))}
          </View>
        </ClassworkModalShell>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: ClassworkUi.bodyBg,
  },
  page: {
    flex: 1,
    padding: 16,
    justifyContent: "center",
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
    padding: 16,
    paddingBottom: 8,
  },
});
