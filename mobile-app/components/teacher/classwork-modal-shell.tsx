import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ClassworkUi } from "@/constants/classwork-ui";
import { NeoShadow } from "@/constants/theme";

type Props = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentStyle?: ViewStyle;
};

export default function ClassworkModalShell({
  title,
  onClose,
  children,
  footer,
  contentStyle,
}: Props) {
  return (
    <View style={styles.outer}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={2}>
            {title}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={22} color={ClassworkUi.title} />
          </TouchableOpacity>
        </View>
        <View style={styles.divider} />
        <View style={[styles.body, contentStyle]}>{children}</View>
        {footer ? (
          <>
            <View style={styles.divider} />
            {footer}
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: "100%",
  },
  card: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    borderRadius: 14,
    backgroundColor: ClassworkUi.bodyBg,
    overflow: "hidden",
    ...NeoShadow.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: ClassworkUi.headerBg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: ClassworkUi.title,
  },
  divider: {
    borderBottomWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(0,0,0,0.25)",
  },
  body: {
    backgroundColor: ClassworkUi.bodyBg,
    maxHeight: 520,
  },
});
