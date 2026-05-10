import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface BadgeProps {
  label: string;
}

export default function Badge({ label }: BadgeProps) {
  return (
    <View style={styles.badge}>
      <Text>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: "#7ABA78",
    borderRadius: 24,
  },
});