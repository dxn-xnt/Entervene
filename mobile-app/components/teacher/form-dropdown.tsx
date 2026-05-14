import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppColors } from "@/constants/theme";

interface DropdownOption {
  label: string;
  value: string;
}

interface FormDropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function FormDropdown({
  options,
  value,
  onChange,
  placeholder = "Select an option",
}: FormDropdownProps) {
  const [open, setOpen] = useState(false);

  const selectedOption = options.find(
    (option) => option.value === value
  );

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={styles.dropdown}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.selectedText}>
          {selectedOption?.label || placeholder}
        </Text>

        <Ionicons
          name="chevron-down"
          size={18}
          color={AppColors.black}
        />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade">
        <TouchableOpacity
          style={styles.overlay}
          onPress={() => setOpen(false)}
          activeOpacity={1}
        >
          <View style={styles.optionList}>
            <FlatList
              data={options}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.option}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <Text style={styles.optionText}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 6,
  },

  dropdown: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: AppColors.black,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },

  selectedText: {
    fontSize: 14,
    color: AppColors.black,
  },

  overlay: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0,0,0,0.3)",
  },

  optionList: {
    backgroundColor: AppColors.background,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: AppColors.black,
    overflow: "hidden",
  },

  option: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
  },

  optionText: {
    fontSize: 14,
  },
});