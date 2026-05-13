import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Modal,
} from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { ClassworkUi } from "@/constants/classwork-ui";

type Props = {
  label: string;
  value: Date | null;
  onChange: (next: Date | null) => void;
  minimumDate?: Date;
  placeholder?: string;
};

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function DatePickerField({
  label,
  value,
  onChange,
  minimumDate,
  placeholder = "Tap to choose a date",
}: Props) {
  const [open, setOpen] = useState(false);
  const [iosDraft, setIosDraft] = useState<Date>(value ?? new Date());

  const onPick = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") {
      setOpen(false);
      if (event.type === "dismissed") return;
      if (date) onChange(stripToLocalNoon(date));
      return;
    }
    if (date) setIosDraft(stripToLocalNoon(date));
  };

  const confirmIos = () => {
    onChange(stripToLocalNoon(iosDraft));
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.field}
        onPress={() => {
          setIosDraft(value ?? new Date());
          setOpen(true);
        }}
        activeOpacity={0.85}
      >
        <Text style={styles.valueText}>
          {value ? formatDate(value) : placeholder}
        </Text>
        <Ionicons name="calendar-outline" size={20} color={ClassworkUi.title} />
      </TouchableOpacity>

      {Platform.OS === "ios" ? (
        <Modal visible={open} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={styles.modalBackdrop}
              activeOpacity={1}
              onPress={() => setOpen(false)}
            />
            <View style={styles.iosSheet}>
              <View style={styles.iosHeader}>
                <TouchableOpacity onPress={clear}>
                  <Text style={styles.link}>Clear</Text>
                </TouchableOpacity>
                <Text style={styles.iosTitle}>Select date</Text>
                <TouchableOpacity onPress={confirmIos}>
                  <Text style={styles.link}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={iosDraft}
                mode="date"
                display="spinner"
                themeVariant="light"
                minimumDate={minimumDate}
                onChange={onPick}
              />
            </View>
          </View>
        </Modal>
      ) : open ? (
        <DateTimePicker
          value={value ?? new Date()}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          onChange={onPick}
        />
      ) : null}
    </View>
  );
}

function stripToLocalNoon(d: Date) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, color: ClassworkUi.title, fontWeight: "500" },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderColor: ClassworkUi.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fff",
  },
  valueText: { fontSize: 14, color: ClassworkUi.title, flex: 1 },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  iosSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: 12,
  },
  iosHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  iosTitle: { fontSize: 15, fontWeight: "700" },
  link: { fontSize: 16, color: "#1565C0", fontWeight: "600" },
});
