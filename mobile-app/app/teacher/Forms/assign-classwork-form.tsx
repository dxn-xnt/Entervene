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
import FormDropdown from "@/components/teacher/form-dropdown";
import FilterDropdown from "@/components/teacher/filter-dropdown";
import FilterCard from "@/components/teacher/filter-cards";

export default function TeacherAssignClasswork() {
  const [uploadTime, setUploadTime] = useState("");
  const [duration, setDuration] = useState("");

  const [assignTo, setAssignTo] = useState("");

  const [selectedSections, setSelectedSections] = useState<string[]>([]);

  const handleAddFilter = (value: string) => {
    if (!selectedSections.includes(value)) {
      setSelectedSections([...selectedSections, value]);
    }
  };

  const handleRemove = (item: string) => {
    setSelectedSections(selectedSections.filter((s) => s !== item));
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        <View style={styles.container}>
          {/* header */}
          <View style={styles.header}>
            <Text style={{ fontSize: 24 }}>Assign Reading Material</Text>
            <TouchableOpacity>
              <Ionicons name="close" size={24} color={AppColors.black} />
            </TouchableOpacity>
          </View>
          <View style={styles.containerContent}>
            <View>
              <Text style={styles.label}>Upload time</Text>
              <FormDropdown
                options={["On the class period"]}
                value={uploadTime}
                onChange={setUploadTime}
              />
            </View>
            <View>
              <Text style={styles.label}>Set duration</Text>
              <FormDropdown
                options={["None"]}
                value={duration}
                onChange={setDuration}
              />
            </View>
            <View style={styles.contentRow}>
              <Text>Assign to</Text>
              <View style={styles.filterRow}>
                {selectedSections.map((section) => (
                  <TouchableOpacity
                    key={section}
                    style={styles.filterChip}
                    onPress={() => handleRemove(section)}
                  >
                    <Text>✕</Text>
                    <Text style={styles.filterChipText}>{section}</Text>
                  </TouchableOpacity>
                ))}
                <FilterDropdown
                  label="Add Filter"
                  options={["Section A", "Section B", "Section C"]}
                  value={assignTo}
                  onChange={handleAddFilter}
                />
              </View>
            </View>
            <View style={styles.cardContainer}>
              <FilterCard label="Section A" onRemove={() => setAssignTo("")} />
              <FilterCard label="Section B" onRemove={() => setAssignTo("")} />
              <FilterCard label="Section C" onRemove={() => setAssignTo("")} />
              <FilterCard label="Section A" onRemove={() => setAssignTo("")} />
              <FilterCard label="Section B" onRemove={() => setAssignTo("")} />
              <FilterCard label="Section C" onRemove={() => setAssignTo("")} />
            </View>
            <FormFooter
              actions={[{ label: "Assign", onPress: () => router.push("/teacher/classworks") }]}
            />
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
  contentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardContainer: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  label: {
    fontSize: 14,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    flex: 1,
    marginLeft: 12,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
    borderColor: AppColors.black,
    backgroundColor: "rgba(0, 0, 0, 0.1)",
  },
  filterChipText: {
    fontSize: 13,
  },
});
