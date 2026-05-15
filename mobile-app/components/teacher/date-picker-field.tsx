import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ClassworkUi } from "@/constants/classwork-ui";

// Only import the native picker on native platforms
let DateTimePicker: any = null;
if (Platform.OS !== "web") {
  DateTimePicker = require("@react-native-community/datetimepicker").default;
}

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

/** Format a Date as "YYYY-MM-DD" for the HTML date input value */
function toInputValue(d: Date | null): string {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Format a Date as "YYYY-MM-DD" for the HTML date input min attribute */
function toMinValue(d: Date | undefined): string {
  return d ? toInputValue(d) : "";
}

function stripToLocalNoon(d: Date) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}

// ─── Web picker ──────────────────────────────────────────────────────────────

function WebDatePicker({
  label,
  value,
  onChange,
  minimumDate,
  placeholder = "Tap to choose a date",
}: Props) {
  const inputRef = useRef<any>(null);

  const handleChange = (e: any) => {
    const v: string = e?.target?.value ?? e?.nativeEvent?.text ?? "";
    if (!v) {
      onChange(null);
      return;
    }
    const [year, month, day] = v.split("-").map(Number);
    const d = new Date(year, month - 1, day, 12, 0, 0, 0);
    onChange(d);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {/* Invisible but fully functional native HTML date input layered under the styled row */}
      <View style={styles.webFieldWrap}>
        <View style={styles.field} pointerEvents="none">
          <Text style={[styles.valueText, !value && styles.placeholder]}>
            {value ? formatDate(value) : placeholder}
          </Text>
          <Ionicons name="calendar-outline" size={20} color={ClassworkUi.title} />
        </View>
        {/* The real <input type="date"> sits on top, fully transparent */}
        <input
          ref={inputRef}
          type="date"
          value={toInputValue(value)}
          min={toMinValue(minimumDate)}
          onChange={handleChange}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            cursor: "pointer",
            width: "100%",
            height: "100%",
            border: "none",
            background: "transparent",
          }}
        />
        {/* Clear button — rendered separately so it stays clickable above the input */}
        {value && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => onChange(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={18} color="#999" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Native picker ────────────────────────────────────────────────────────────

function NativeDatePicker({
  label,
  value,
  onChange,
  minimumDate,
  placeholder = "Tap to choose a date",
}: Props) {
  const [open, setOpen] = useState(false);
  const [iosDraft, setIosDraft] = useState<Date>(value ?? new Date());

  const onPick = (event: any, date?: Date) => {
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
        <Text style={[styles.valueText, !value && styles.placeholder]}>
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

// ─── Exported component ───────────────────────────────────────────────────────

export default function DatePickerField(props: Props) {
  if (Platform.OS === "web") return <WebDatePicker {...props} />;
  return <NativeDatePicker {...props} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, color: ClassworkUi.title, fontWeight: "500" },
  // Web wrapper needs `position: relative` for the overlay input
  webFieldWrap: {
    position: "relative",
  } as any,
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
  placeholder: { color: "#aaa" },
  clearBtn: {
    position: "absolute",
    right: 40,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    zIndex: 10,
  },
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