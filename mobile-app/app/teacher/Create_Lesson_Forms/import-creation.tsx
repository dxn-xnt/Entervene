import React, { useState } from "react";
import { router } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { AppColors, NeoShadow } from "@/constants/theme";
import FormFooter from "@/components/teacher/form-footer";
import FormDropdown from "@/components/teacher/form-dropdown";

const SAMPLE_LESSONS = [
  {
    id: "1",
    title: "Introduction to Programming",
    description:
      "This topic introduces learners to the basics of coding, including understanding algorithms, syntax, data types, variables, and control structures such as loops and conditionals. Students will also explore how programs are designed to solve problems through logical thinking and step-by-step instructions.",
  },
  {
    id: "2",
    title: "Data Types and Variables",
    description:
      "This topic builds on the foundations of Introduction to Programming by focusing on two essential elements of coding—data types and variables. Learners will explore how data is represented and stored in a program, including common types such as integers, floats, strings, and booleans.",
  },
  {
    id: "3",
    title: "Control Structures and Decision Making",
    description:
      "This topic introduces learners to the fundamental concepts of control flow in programming. It explains how decision-making and repetition are implemented using conditional statements (such as if, else if, and else) and looping structures (for and while loops).",
  },
  {
    id: "4",
    title: "Functions and Modular Programming",
    description:
      "This topic focuses on organizing and simplifying code through the use of functions. Learners will discover how functions help in breaking down complex problems into smaller, reusable blocks of code.",
  },
];

export default function ImportCreation() {
  const [subject, setSubject] = useState("");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Import from file</Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="close" size={24} color={AppColors.black} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View>
              <Text style={styles.label}>Subject</Text>
              <FormDropdown
                options={[
                  { label: "Computer Programming", value: "Computer Programming" },
                  { label: "Mathematics", value: "Mathematics" },
                  { label: "Science", value: "Science" },
                ]}
                value={subject}
                onChange={setSubject}
              />
            </View>

            <Text style={styles.label}>Lessons added</Text>

            {SAMPLE_LESSONS.map((lesson) => (
              <View key={lesson.id} style={styles.lessonCard}>
                <View style={styles.lessonCardHeader}>
                  <Text style={styles.lessonTitle}>{lesson.title}</Text>
                  <TouchableOpacity>
                    <Ionicons name="pencil-outline" size={16} color={AppColors.black} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.lessonDesc}>{lesson.description}</Text>
              </View>
            ))}
          </ScrollView>

          <FormFooter
            actions={[{ label: "Add", onPress: () => router.back() }]}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  body: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  container: {
    borderWidth: 2,
    borderRadius: 16,
    shadowColor: AppColors.black,
    ...NeoShadow.lg,
    width: "100%",
    maxHeight: "90%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#7ABA78",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  headerTitle: { fontSize: 20, fontWeight: "600" },
  content: { gap: 12, padding: 16, paddingBottom: 24 },
  label: { fontSize: 14, marginBottom: 4 },
  lessonCard: {
    borderWidth: 1,
    borderColor: AppColors.black,
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#fff",
    gap: 6,
  },
  lessonCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  lessonTitle: { fontSize: 16, fontWeight: "700", flex: 1 },
  lessonDesc: { fontSize: 12, color: "#444", lineHeight: 18 },
});