import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

interface FormFooterProps {
  actions: {
    label: string;
    onPress: () => void;
    style?: object;
    textStyle?: object;
  }[];
}

export default function FormFooter({ actions }: FormFooterProps) {
  return (
    <View style={styles.formFooter}>
      {actions.map((action, index) => (
        <TouchableOpacity
          key={index}
          style={[styles.actionButton, action.style]}
          onPress={action.onPress}
          activeOpacity={0.85}
        >
          <Text style={[{ fontWeight: "700", fontSize: 15, color: "#000" }, action.textStyle]}>
            {action.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  formFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    borderTopWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: "#fff",
  },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderRadius: 10,
    borderColor: "#000",
    backgroundColor: "#fff",
  },
});