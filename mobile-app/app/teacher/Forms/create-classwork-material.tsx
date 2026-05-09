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

import { AppColors, Spacing, Borders, NeoShadow } from "@/constants/theme";

import FormFooter from "@/components/teacher/form-footer";
import FormDropdown from "@/components/teacher/form-dropdown";
import AddButton from "@/components/teacher/add-button-form";
// import Card from "@/components/teacher/form-card";

export default function TeacherNewMaterial() {
  const [subject, setSubject] = useState("");
  const [lesson, setLesson] = useState("");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        <View style={styles.container}>
          {/* header */}
          <View style={styles.header}>
            <Text style={{ fontSize: 24 }}>Create new classwork</Text>
            <TouchableOpacity>X</TouchableOpacity>
          </View>
          <View style={styles.containerContent}>
            <View>
              {/* Subject  */}
              <Text style={styles.label}>Subject</Text>
              <FormDropdown
                options={["Computer Programming", "Mathematics", "Science"]}
                value={subject}
                onChange={setSubject}
              />
            </View>
            {/* Lesson  */}
            <View>
              <Text style={styles.label}>Lesson</Text>
              <FormDropdown
                options={["Introduction to Programming", "Variables", "Loops"]}
                value={lesson}
                onChange={setLesson}
              />
            </View>
            <Text>Upload Material</Text>
            <View>
                {/* this will handle the uploading of file, iprompt lang nya <3  */}
                <AddButton />
            </View>
          </View>
          <FormFooter actions={[{ label: "Next", onPress: () => {} }]} />
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
  },
  containerContent: {
    gap: 20,
    padding: 16,
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
  },
});
