import React, { useState } from "react";
import { router } from "expo-router";
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

export default function ManualCreation() {
  const [subject, setSubject] = useState("");
  const [lesson, setLesson] = useState("");
  const [description, setDescription] = useState("");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Create lessons</Text>
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
                options={["Computer Programming", "Mathematics", "Science"]}
                value={subject}
                onChange={setSubject}
              />
            </View>

            <View>
              <Text style={styles.label}>Lesson</Text>
              <TextInput
                style={styles.textInput}
                value={lesson}
                onChangeText={setLesson}
              />
            </View>

            <View>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={description}
                onChangeText={setDescription}
                multiline
                textAlignVertical="top"
              />
            </View>
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
  content: { gap: 16, padding: 16, paddingBottom: 24 },
  label: { fontSize: 14, marginBottom: 4 },
  textInput: {
    borderWidth: 1,
    borderColor: AppColors.black,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: "#fff",
  },
  textArea: { height: 120 },
});