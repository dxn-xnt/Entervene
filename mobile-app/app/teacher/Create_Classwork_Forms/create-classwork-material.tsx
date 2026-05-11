import React, { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { AppColors, NeoShadow } from "@/constants/theme";
import FormFooter from "@/components/teacher/form-footer";
import FormDropdown from "@/components/teacher/form-dropdown";
import AddButton from "@/components/teacher/add-button-form";
import MaterialCard from "@/components/teacher/material-card";

type ClassworkType = "reading" | "quiz" | "assignment" | "activity";

const TITLES: Record<ClassworkType, string> = {
  reading: "Reading",
  quiz: "Quiz",
  assignment: "Assignment",
  activity: "Activity",
};

const RUBRIC_LEVELS = [
  {
    label: "Excellent",
    pts: 10,
    desc: "Displays all required components clearly and accurately.",
  },
  {
    label: "Good",
    pts: 8,
    desc: "Most components are present with minor errors.",
  },
  {
    label: "Fair",
    pts: 6,
    desc: "Some required parts are missing or unclear.",
  },
  {
    label: "Needs Improvement",
    pts: 4,
    desc: "Many required elements are missing.",
  },
  { label: "Poor", pts: 2, desc: "Work is incomplete or not submitted." },
];

function ActivityRubric() {
  return (
    <View style={rubricStyles.wrapper}>
      <Text style={rubricStyles.title}>Activity Rubric</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={rubricStyles.row}>
          {RUBRIC_LEVELS.map((level) => (
            <View key={level.label} style={rubricStyles.cell}>
              <View style={rubricStyles.cellHeader}>
                <Text style={rubricStyles.levelLabel}>{level.label}</Text>
                <Text style={rubricStyles.pts}>{level.pts} pts</Text>
              </View>
              <Text style={rubricStyles.desc}>{level.desc}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function AssignmentForm() {
  const [subject, setSubject] = useState("");
  const [topicTitle, setTopicTitle] = useState("");
  const [description, setDescription] = useState("");
  const [gradingComponent, setGradingComponent] = useState("");

  return (
    <>
      <View>
        <Text style={styles.label}>Subject</Text>
        <FormDropdown
          options={["Computer Programming", "Mathematics", "Science"]}
          value={subject}
          onChange={setSubject}
        />
      </View>

      <View>
        <Text style={styles.label}>Topic title</Text>
        <TextInput
          style={styles.textInput}
          value={topicTitle}
          onChangeText={setTopicTitle}
          placeholder="e.g. Introduction to Programming Reading Materials"
          placeholderTextColor="#aaa"
        />
      </View>

      <View>
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.textInput}
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Answer the following in one whole sheet of paper."
          placeholderTextColor="#aaa"
        />
      </View>

      <View>
        <Text style={styles.label}>Upload material</Text>
        <View style={styles.addMaterialContainer}>
          <MaterialCard
            filename="Basic English Notes"
            fileType="Docx"
            onRemove={() => {}}
          />
          <MaterialCard
            filename="Basic English Prese..."
            fileType="Pptx"
            onRemove={() => {}}
          />
          <AddButton />
        </View>
      </View>

      <View>
        <Text style={styles.label}>Grading Component</Text>
        <FormDropdown
          options={[
            "Written Works",
            "Performance Task",
            "Quarterly Assessment",
          ]}
          value={gradingComponent}
          onChange={setGradingComponent}
        />
      </View>

      <View>
        <Text style={styles.label}>Rubrics</Text>
        <ActivityRubric />
      </View>
    </>
  );
}

function QuizForm() {
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");

  return (
    <>
      <View>
        <Text style={styles.label}>Subject</Text>
        <FormDropdown
          options={["Computer Programming", "Mathematics", "Science"]}
          value={subject}
          onChange={setSubject}
        />
      </View>

      <View>
        <Text style={styles.label}>Quiz title</Text>
        <TextInput
          style={styles.textInput}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Unit 1 Quiz"
          placeholderTextColor="#aaa"
        />
      </View>

      <View>
        <Text style={styles.label}>Duration (minutes)</Text>
        <TextInput
          style={styles.textInput}
          value={duration}
          onChangeText={setDuration}
          placeholder="e.g. 30"
          placeholderTextColor="#aaa"
          keyboardType="numeric"
        />
      </View>
    </>
  );
}

function MaterialForm() {
  const [subject, setSubject] = useState("");
  const [lesson, setLesson] = useState("");

  return (
    <>
      <View>
        <Text style={styles.label}>Subject</Text>
        <FormDropdown
          options={["Computer Programming", "Mathematics", "Science"]}
          value={subject}
          onChange={setSubject}
        />
      </View>

      <View>
        <Text style={styles.label}>Lesson</Text>
        <FormDropdown
          options={["Introduction to Programming", "Variables", "Loops"]}
          value={lesson}
          onChange={setLesson}
        />
      </View>

      <View>
        <Text style={styles.label}>Upload Material</Text>
        <View style={styles.addMaterialContainer}>
          <MaterialCard
            filename="Basic English Notes"
            fileType="Docx"
            onRemove={() => {}}
          />
          <MaterialCard
            filename="Basic English Prese..."
            fileType="Pptx"
            onRemove={() => {}}
          />
          <AddButton />
        </View>
      </View>
    </>
  );
}

function QuestionForm() {
  const [subject, setSubject] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [points, setPoints] = useState("");

  return (
    <>
      <View>
        <Text style={styles.label}>Subject</Text>
        <FormDropdown
          options={["Computer Programming", "Mathematics", "Science"]}
          value={subject}
          onChange={setSubject}
        />
      </View>

      <View>
        <Text style={styles.label}>Question</Text>
        <TextInput
          style={[styles.textInput, { height: 80, textAlignVertical: "top" }]}
          value={questionText}
          onChangeText={setQuestionText}
          placeholder="Type your question here..."
          placeholderTextColor="#aaa"
          multiline
        />
      </View>

      <View>
        <Text style={styles.label}>Points</Text>
        <TextInput
          style={styles.textInput}
          value={points}
          onChangeText={setPoints}
          placeholder="e.g. 10"
          placeholderTextColor="#aaa"
          keyboardType="numeric"
        />
      </View>
    </>
  );
}

export default function CreateClassworkForm() {
  // Read which type was passed from the card selector
  const { type } = useLocalSearchParams<{ type: ClassworkType }>();
  const classworkType: ClassworkType = type ?? "material";

  const renderForm = () => {
    switch (classworkType) {
      case "reading":
        return <MaterialForm />;
      case "quiz":
        return <QuizForm />;
      case "assignment":
        return <AssignmentForm />;
      case "activity":
        return <QuestionForm />;
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={{ fontSize: 20, fontWeight: "600" }}>
              {TITLES[classworkType]}
            </Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="close" size={24} color={AppColors.black} />
            </TouchableOpacity>
          </View>

          {/* Scrollable form body */}
          <ScrollView
            contentContainerStyle={styles.containerContent}
            showsVerticalScrollIndicator={false}
          >
            {renderForm()}
          </ScrollView>

          {/* Footer */}
          <FormFooter
            actions={[
              {
                label: "Next",
                onPress: () =>
                  router.push("/teacher/Create_Classwork_Forms/assign-classwork-form"),
              },
            ]}
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
    maxHeight: "90%",
  },
  containerContent: {
    gap: 16,
    padding: 16,
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  label: {
    fontSize: 14,
    marginBottom: 4,
  },
  textInput: {
    borderWidth: 1,
    borderColor: AppColors.black,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: "#fff",
  },
  addMaterialContainer: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
});

const rubricStyles = StyleSheet.create({
  wrapper: {
    borderWidth: 1,
    borderColor: AppColors.black,
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fff",
  },
  title: {
    fontWeight: "600",
    fontSize: 14,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  cell: {
    width: 120,
    padding: 8,
    borderWidth: 1,
    borderRadius: 8,
    gap: 4,
  },
  cellHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  levelLabel: {
    fontWeight: "600",
    fontSize: 12,
  },
  pts: {
    fontSize: 11,
  },
  desc: {
    fontSize: 11,
    color: "#444",
  },
});
