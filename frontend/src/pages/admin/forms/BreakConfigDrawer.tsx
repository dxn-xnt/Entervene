import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { TimePickerSingle, type TimeValue } from "@/components/retroui/TimePicker";
import { apiFetch } from "@/lib/api";
import { useSettings } from "@/context/SettingsContext";
import { validatePeriodTimeRange } from "@/lib/time-utils";
import { Clock, Save, Coffee, Utensils, Sunrise, Plus, Trash2, FolderPlus } from "lucide-react";

export type PeriodTemplateSlotItem = {
  slot_id?: number | null;
  template_group: string;
  slot_name: string;
  slot_type: "CLASS" | "RECESS" | "LUNCH" | "HOMEROOM";
  start_time: string;
  end_time: string;
  is_locked_break: boolean;
  display_order: number;
};

interface BreakConfigDrawerProps {
  open: boolean;
  onClose: () => void;
  initialSlots?: PeriodTemplateSlotItem[];
  onSaved: () => void;
}

function stringToTimeValue(str?: string | null, fallbackHour = 8): TimeValue {
  if (!str) return { hour: fallbackHour, minute: 0, period: "AM" };
  const parts = str.split(":");
  if (parts.length < 2) return { hour: fallbackHour, minute: 0, period: "AM" };
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) || 0;
  let p = "AM";
  if (h >= 12) {
    p = "PM";
    if (h > 12) h -= 12;
  } else if (h === 0) {
    h = 12;
  }
  return { hour: h, minute: m, period: p };
}

function timeValueToString(tv: TimeValue): string {
  let h = tv.hour;
  if (tv.period === "PM" && h < 12) h += 12;
  if (tv.period === "AM" && h === 12) h = 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(tv.minute)}`;
}

function formatGroupName(grp: string): string {
  switch (grp) {
    case "JHS_45MIN":
      return "Junior High (Grades 7–10)";
    case "SHS_CAMPOS_ZARA":
      return "SHS STEM / Medical (Campos & Zara)";
    case "SHS_DELMUNDO_REYES":
      return "SHS General (Del Mundo & Reyes)";
    default:
      return grp.replace(/_/g, " ");
  }
}

export default function BreakConfigDrawer({
  open,
  onClose,
  initialSlots = [],
  onSaved,
}: BreakConfigDrawerProps) {
  const { getSetting } = useSettings();
  const [activeGroup, setActiveGroup] = useState<string>("JHS_45MIN");
  const [slots, setSlots] = useState<PeriodTemplateSlotItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Fetch period templates directly from DB on open
  useEffect(() => {
    if (!open) return;
    const fetchTemplates = async () => {
      setIsLoading(true);
      setNotice(null);
      try {
        const res = await apiFetch("/api/v1/subject-loads/period-templates");
        if (res.ok) {
          const data = (await res.json()) as PeriodTemplateSlotItem[];
          if (data && data.length > 0) {
            setSlots(data);
            return;
          }
        }
      } catch (err) {
        console.error("Error loading period templates:", err);
      } finally {
        setIsLoading(false);
      }
      // Fall back to initial slots if provided
      if (initialSlots && initialSlots.length > 0) {
        setSlots(initialSlots);
      }
    };
    void fetchTemplates();
  }, [open, initialSlots]);

  // Dynamically compute template groups from DB slots
  const templateGroups = useMemo(() => {
    const set = new Set(slots.map((s) => s.template_group));
    if (!set.has("JHS_45MIN")) set.add("JHS_45MIN");
    if (!set.has("SHS_CAMPOS_ZARA")) set.add("SHS_CAMPOS_ZARA");
    if (!set.has("SHS_DELMUNDO_REYES")) set.add("SHS_DELMUNDO_REYES");
    return Array.from(set);
  }, [slots]);

  useEffect(() => {
    if (!templateGroups.includes(activeGroup)) {
      setActiveGroup(templateGroups[0] || "JHS_45MIN");
    }
  }, [templateGroups, activeGroup]);

  const activeSlots = slots
    .filter((s) => s.template_group === activeGroup)
    .sort((a, b) => a.display_order - b.display_order);

  const handleSlotFieldChange = (
    slotId: number | undefined,
    displayOrder: number,
    field: keyof PeriodTemplateSlotItem,
    value: any
  ) => {
    if (field === "start_time" || field === "end_time") {
      const s = slots.find(
        (st) =>
          st.template_group === activeGroup &&
          ((slotId && st.slot_id === slotId) || st.display_order === displayOrder)
      );
      if (s) {
        const start = field === "start_time" ? value : s.start_time;
        const end = field === "end_time" ? value : s.end_time;
        const schoolDayStart = getSetting("school_day_start", "06:00");
        const schoolDayEnd = getSetting("school_day_end", "20:00");
        const errorMsg = validatePeriodTimeRange(start, end, schoolDayStart, schoolDayEnd);
        if (errorMsg) {
          setNotice(errorMsg);
          return;
        } else {
            setNotice(null);
        }
      }
    }

    setSlots((prev) =>
      prev.map((s) => {
        if (
          s.template_group === activeGroup &&
          ((slotId && s.slot_id === slotId) || s.display_order === displayOrder)
        ) {
          return { ...s, [field]: value };
        }
        return s;
      })
    );
  };

  const handleAddSlot = () => {
    const nextOrder = activeSlots.length > 0 ? Math.max(...activeSlots.map((s) => s.display_order)) + 1 : 1;
    const newSlot: PeriodTemplateSlotItem = {
      template_group: activeGroup,
      slot_name: "New Time Slot",
      slot_type: "CLASS",
      start_time: "15:30",
      end_time: "16:15",
      is_locked_break: false,
      display_order: nextOrder,
    };
    setSlots((prev) => [...prev, newSlot]);
  };

  const handleRemoveSlot = (displayOrder: number, slotId?: number | null) => {
    setSlots((prev) =>
      prev.filter(
        (s) =>
          !(
            s.template_group === activeGroup &&
            ((slotId && s.slot_id === slotId) || s.display_order === displayOrder)
          )
      )
    );
  };

  const handleAddTemplateGroup = () => {
    const rawGroup = prompt("Enter new section template group name (e.g. SHS_TVL or REMEDIAL_SUMMER):");
    if (!rawGroup) return;
    const formattedGroup = rawGroup.trim().toUpperCase().replace(/\s+/g, "_");
    if (templateGroups.includes(formattedGroup)) {
      alert("This template group name already exists.");
      return;
    }
    const defaultSlots: PeriodTemplateSlotItem[] = [
      {
        template_group: formattedGroup,
        slot_name: "Homeroom Guidance",
        slot_type: "HOMEROOM",
        start_time: "07:30",
        end_time: "08:00",
        is_locked_break: true,
        display_order: 1,
      },
      {
        template_group: formattedGroup,
        slot_name: "Period 1",
        slot_type: "CLASS",
        start_time: "08:00",
        end_time: "09:00",
        is_locked_break: false,
        display_order: 2,
      },
      {
        template_group: formattedGroup,
        slot_name: "Morning Recess",
        slot_type: "RECESS",
        start_time: "09:00",
        end_time: "09:20",
        is_locked_break: true,
        display_order: 3,
      },
      {
        template_group: formattedGroup,
        slot_name: "Lunch Break",
        slot_type: "LUNCH",
        start_time: "12:00",
        end_time: "13:00",
        is_locked_break: true,
        display_order: 4,
      },
    ];
    setSlots((prev) => [...prev, ...defaultSlots]);
    setActiveGroup(formattedGroup);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setNotice(null);
    try {
      const res = await apiFetch("/api/v1/subject-loads/period-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slots),
      });

      if (!res.ok) {
        throw new Error("Failed to save period template break settings.");
      }

      onSaved();
      onClose();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error saving break settings.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val && !isSaving) onClose(); }}>
      <Dialog.Content size="3xl" className="border-2 border-black p-0 max-h-[92vh] overflow-y-auto">
        <Dialog.Header className="border-b-2 border-black bg-primary px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-5 text-black" />
            <div>
              <h2 className="text-lg font-bold">Configure Timetable Breaks & Period Templates</h2>
              <p className="text-xs text-black/80">
                Manage Homeroom, Recess, Lunch, and Period slots dynamically per Section Group
              </p>
            </div>
          </div>
        </Dialog.Header>

        <div className="p-5 space-y-4">
          {notice && (
            <div className="p-3 border-2 border-black bg-red-100 text-red-900 font-bold text-xs">
              {notice}
            </div>
          )}

          {/* Group Tab Switcher & New Group Button */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-black pb-3">
            <div className="flex flex-wrap gap-1.5">
              {templateGroups.map((grpKey) => (
                <button
                  key={grpKey}
                  type="button"
                  onClick={() => setActiveGroup(grpKey)}
                  className={`px-3 py-1.5 text-xs font-bold border-2 border-black transition-all ${
                    activeGroup === grpKey
                      ? "bg-black text-white shadow-[2px_2px_0_#000]"
                      : "bg-white text-black hover:bg-gray-100"
                  }`}
                >
                  {formatGroupName(grpKey)}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddTemplateGroup}
              className="text-xs font-bold flex items-center gap-1 bg-purple-100 hover:bg-purple-200 border-2 border-black px-2.5 py-1.5 rounded shadow-[1px_1px_0_#000]"
              title="Create a new section template group"
            >
              <FolderPlus className="size-3.5 text-purple-900" />
              <span>+ New Group</span>
            </button>
          </div>

          {isLoading ? (
            <div className="p-8 text-center border-2 border-black bg-gray-50 font-bold text-sm">
              Loading period templates from database...
            </div>
          ) : activeSlots.length === 0 ? (
            <div className="p-6 text-center border-2 border-black bg-amber-50 font-bold text-sm">
              No time slots configured for {formatGroupName(activeGroup)}.
              <div className="mt-3">
                <Button size="sm" onClick={handleAddSlot} className="border-2 border-black bg-amber-300 hover:bg-amber-400">
                  <Plus className="size-4 mr-1" /> Add First Slot
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {activeSlots.map((slot) => {
                return (
                  <div
                    key={`${slot.template_group}_${slot.display_order}_${slot.slot_id || slot.slot_name}`}
                    className={`p-3 border-2 border-black flex flex-wrap items-center justify-between gap-3 ${
                      slot.slot_type === "LUNCH"
                        ? "bg-sky-100/90"
                        : slot.slot_type === "RECESS"
                        ? "bg-amber-100/90"
                        : slot.slot_type === "HOMEROOM"
                        ? "bg-purple-100/90"
                        : "bg-white"
                    }`}
                  >
                    {/* Editable Slot Label & Type */}
                    <div className="flex items-center gap-2.5 min-w-[240px] flex-1">
                      {slot.slot_type === "HOMEROOM" && <Sunrise className="size-4 text-purple-900 shrink-0" />}
                      {slot.slot_type === "RECESS" && <Coffee className="size-4 text-amber-900 shrink-0" />}
                      {slot.slot_type === "LUNCH" && <Utensils className="size-4 text-sky-900 shrink-0" />}
                      {slot.slot_type === "CLASS" && <Clock className="size-4 text-gray-700 shrink-0" />}

                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          value={slot.slot_name}
                          onChange={(e) =>
                            handleSlotFieldChange(slot.slot_id ?? undefined, slot.display_order, "slot_name", e.target.value)
                          }
                          className="w-full border-2 border-black bg-white px-2 py-0.5 text-xs font-bold rounded shadow-[1px_1px_0_#000]"
                          placeholder="Slot Label (e.g. Morning Recess)"
                        />

                        <div className="flex items-center gap-2">
                          <select
                            value={slot.slot_type}
                            onChange={(e) => {
                              const newType = e.target.value as any;
                              const isLocked = newType !== "CLASS";
                              handleSlotFieldChange(slot.slot_id ?? undefined, slot.display_order, "slot_type", newType);
                              handleSlotFieldChange(slot.slot_id ?? undefined, slot.display_order, "is_locked_break", isLocked);
                            }}
                            className="text-[11px] font-bold border border-black bg-white px-1.5 py-0.5 rounded"
                          >
                            <option value="CLASS">CLASS</option>
                            <option value="RECESS">RECESS</option>
                            <option value="LUNCH">LUNCH</option>
                            <option value="HOMEROOM">HOMEROOM</option>
                          </select>

                          <label className="flex items-center gap-1 text-[11px] font-bold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={slot.is_locked_break}
                              onChange={(e) =>
                                handleSlotFieldChange(
                                  slot.slot_id ?? undefined,
                                  slot.display_order,
                                  "is_locked_break",
                                  e.target.checked
                                )
                              }
                            />
                            <span>Lock Break Wall</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Start and End Pickers */}
                    <div className="flex items-center gap-2">
                      <TimePickerSingle
                        value={stringToTimeValue(slot.start_time, 8)}
                        onChange={(newStart) =>
                          handleSlotFieldChange(
                            slot.slot_id ?? undefined,
                            slot.display_order,
                            "start_time",
                            timeValueToString(newStart)
                          )
                        }
                      />
                      <span className="text-xs font-bold text-black">to</span>
                      <TimePickerSingle
                        value={stringToTimeValue(slot.end_time, 9)}
                        onChange={(newEnd) =>
                          handleSlotFieldChange(
                            slot.slot_id ?? undefined,
                            slot.display_order,
                            "end_time",
                            timeValueToString(newEnd)
                          )
                        }
                      />

                      <button
                        type="button"
                        onClick={() => handleRemoveSlot(slot.display_order, slot.slot_id)}
                        className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 border border-red-300 rounded ml-1"
                        title="Remove slot"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleAddSlot}
                  className="w-full border-2 border-dashed border-black bg-white hover:bg-gray-50 py-2 text-xs font-bold flex items-center justify-center gap-1 rounded"
                >
                  <Plus className="size-4 text-primary" />
                  <span>+ Add Time Slot to {formatGroupName(activeGroup)}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t-2 border-black bg-gray-50 px-5 py-3 flex items-center justify-end gap-3">
          <Button variant="outline" disabled={isSaving} onClick={onClose} className="border-2 border-black font-bold">
            Cancel
          </Button>
          <Button
            variant="default"
            disabled={isSaving}
            onClick={() => void handleSave()}
            className="border-2 border-black bg-emerald-400 hover:bg-emerald-500 font-bold"
          >
            <Save className="size-4 mr-2" />
            {isSaving ? "Saving..." : "Save Break Timelines"}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
