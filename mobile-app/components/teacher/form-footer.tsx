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
        <TouchableOpacity key={index} style={[styles.actionButton, action.style]} onPress={action.onPress}>
          <Text style={action.textStyle}>{action.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  formFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    borderTopWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  actionButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
});