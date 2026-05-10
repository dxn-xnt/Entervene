import React from "react";
import { Text, View, StyleSheet } from "react-native";
import { AppColors } from "@/constants/theme";

interface StatTag {
  icon?: React.ReactNode;
  label: string;
  count?: number;
}

interface InfoCardProps {
  title: string;
  subtitle?: string;
  stats: StatTag[];
}

export default function InfoCard({ title, subtitle, stats }: InfoCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
        {title}
      </Text>
      {subtitle && (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      )}
      <View style={styles.tagsRow}>
        {stats.map((s, i) => (
          <View key={i} style={styles.tag}>
            {s.icon}
            <Text style={styles.tagText}>
              {s.label}
              {s.count != null ? ` ${s.count}` : ""}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#F5E9B8",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.black,
    padding: 14,
    gap: 8,
    alignSelf: "flex-start", 
    minWidth: 160,
    maxWidth: 220,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: AppColors.black,
  },
  subtitle: {
    fontSize: 12,
    marginTop: -4,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: AppColors.black,
    backgroundColor: "white",
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  tagText: {
    fontSize: 12,
    color: AppColors.black,
  },
});
