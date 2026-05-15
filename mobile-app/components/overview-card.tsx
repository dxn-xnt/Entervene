import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { AppColors, NeoShadow } from "@/constants/theme";

interface StatCardProps {
  label: string;
  value: number;
  unit?: string;
  change?: string;
}

export default function StatCard({ label, value, unit = "%", change }: StatCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>
        {value}<Text style={styles.unit}>{unit}</Text>
      </Text>
      {change && <Text style={styles.change}>{change}+ increased from last month</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: AppColors.black,
    backgroundColor: "#f0e68c",
    ...NeoShadow.lg,
    gap: 4,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
  },
  value: {
    fontSize: 34,
    fontWeight: "800",
  },
  unit: {
    fontSize: 20,
    fontWeight: "600",
  },
  change: {
    fontSize: 12,
  },
});