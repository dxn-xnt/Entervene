import React from "react";
import { router } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { AppColors, NeoShadow } from "@/constants/theme";
import FormFooter from "@/components/teacher/form-footer";

export default function UploadFile() {
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

          <View style={styles.uploadArea}>
            <TouchableOpacity style={styles.uploadButton}>
              <Text style={styles.uploadButtonText}>Upload</Text>
            </TouchableOpacity>
            <Text style={styles.dragText}>Drag & drop file here</Text>
          </View>

          <FormFooter
            actions={[
              {
                label: "Next",
                onPress: () =>
                  router.push("/teacher/Create_Lesson_Forms/import-creation"),
              },
            ]}
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
  uploadArea: {
    height: 180,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    margin: 16,
    borderWidth: 1,
    borderColor: AppColors.black,
    borderRadius: 10,
    borderStyle: "dashed",
  },
  uploadButton: {
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderRadius: 8,
    borderColor: AppColors.black,
    backgroundColor: "#fff",
  },
  uploadButtonText: { fontSize: 14, fontWeight: "600" },
  dragText: { fontSize: 12, color: "#666" },
});