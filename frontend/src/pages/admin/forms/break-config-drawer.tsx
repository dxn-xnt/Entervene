import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Empty } from "@/components/retroui/Empty";
import { Input } from "@/components/retroui/Input";
import { Label } from "@/components/retroui/Label";
import { Loader } from "@/components/retroui/Loader";
import { Select } from "@/components/retroui/Select";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { Text } from "@/components/retroui/Text";
import { Alert } from "@/components/retroui/Alert";
import { TimePickerSingle, type TimeValue } from "@/components/retroui/TimePicker";
import { apiFetch } from "@/lib/api";
import type { SubjectLoadStudioData } from "@/lib/api";
import { useSettings } from "@/context/SettingsContext";
import { validatePeriodTimeRange } from "@/lib/time-utils";
import { cn } from "@/lib/utils";
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
  initialGroup?: string;
  onSaved: () => void;
  studioData?: SubjectLoadStudioData | null;
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
      return "SHS Engineering / Medical (Campos & Zara)";
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
  initialGroup,
  onSaved,
  studioData,
}: BreakConfigDrawerProps) {
  const { getSetting } = useSettings();
  const [activeGroup, setActiveGroup] = useState<string>(initialGroup || "JHS_45MIN");
  const [slots, setSlots] = useState<PeriodTemplateSlotItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReassigning, setIsReassigning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [newGroupNameInput, setNewGroupNameInput] = useState("");
  const [newGroupError, setNewGroupError] = useState<string | null>(null);

  // Sync activeGroup whenever initialGroup changes or drawer opens
  useEffect(() => {
    if (open && initialGroup) {
      setActiveGroup(initialGroup);
    }
  }, [open, initialGroup]);

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

  const groupTabs = useMemo<TabItem[]>(() => {
    return templateGroups.map((grpKey) => ({
      id: grpKey,
      label: formatGroupName(grpKey),
    }));
  }, [templateGroups]);

  const groupSlotCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of slots) {
      map[s.template_group] = (map[s.template_group] || 0) + 1;
    }
    return map;
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
    setNewGroupNameInput("");
    setNewGroupError(null);
    setShowNewGroupModal(true);
  };

  const handleConfirmAddGroup = () => {
    if (!newGroupNameInput.trim()) {
      setNewGroupError("Please enter a group name.");
      return;
    }
    const formattedGroup = newGroupNameInput.trim().toUpperCase().replace(/\s+/g, "_");
    if (templateGroups.includes(formattedGroup)) {
      setNewGroupError("This template group name already exists.");
      return;
    }
    // Clone base template from JHS_45MIN (or first available template group)
    const baseGroup = templateGroups.includes("JHS_45MIN") ? "JHS_45MIN" : (templateGroups[0] || "");
    const baseSlots = slots.filter((s) => s.template_group === baseGroup);
    const clonedSlots: PeriodTemplateSlotItem[] = baseSlots.map((s) => ({
      ...s,
      slot_id: undefined,
      template_group: formattedGroup,
    }));
    setSlots((prev) => [...prev, ...clonedSlots]);
    setActiveGroup(formattedGroup);
    setShowNewGroupModal(false);
  };

  const handleSaveClick = () => {
    setNotice(null);
    setShowConfirmModal(true);
  };

  const executeSave = async () => {
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

      setShowConfirmModal(false);
      onSaved();
      onClose();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error saving break settings.");
      setShowConfirmModal(false);
    } finally {
      setIsSaving(false);
    }
  };

  const assignedClasses = useMemo(() => {
    return (studioData?.classes || []).filter((c) => c.period_template_group === activeGroup);
  }, [studioData, activeGroup]);

  const otherClasses = useMemo(() => {
    return (studioData?.classes || []).filter((c) => c.period_template_group !== activeGroup);
  }, [studioData, activeGroup]);

  const handleReassignClass = async (classId: number, targetGroup: string) => {
    setIsReassigning(true);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/v1/subject-loads/classes/${classId}/template-group`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_group: targetGroup }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to reassign section.");
      }
      const data = await res.json();
      if (data.conflicts && data.conflicts.length > 0) {
        const errorConflicts = data.conflicts.filter((c: any) => c.severity === "error");
        if (errorConflicts.length > 0) {
          setNotice(`Warning: Reassigned section, but detected ${errorConflicts.length} schedule conflict(s) with new break walls.`);
        }
      }
      onSaved();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to reassign section.");
    } finally {
      setIsReassigning(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(val) => { if (!val && !isSaving) onClose(); }}>
        <Dialog.Content size="2xl" className="max-h-[90vh]">
          <Dialog.Header position="static">
            <div className="flex items-center gap-2">
              <Clock className="size-5 shrink-0" />
              <Text as="h5" className="font-sans text-lg font-bold">
                Configure Timetable Breaks & Period Templates
              </Text>
            </div>
          </Dialog.Header>

          <section className="flex flex-1 flex-col overflow-y-auto px-4 py-1 min-h-0 max-h-[72vh]">
            {notice && (
              <Alert status="error">
                <Alert.Description>{notice}</Alert.Description>
              </Alert>
            )}

            {/* Group Tab Switcher & New Group Button */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <Tabs
                  tabs={groupTabs}
                  activeTab={activeGroup}
                  onTabChange={setActiveGroup}
                  counts={groupSlotCounts}
                  className="!mx-0 !border-b-0 text-xs"
                />
              </div>

              <Button
                type="button"
                size="sm"
                onClick={handleAddTemplateGroup}
                className="text-xs gap-2 shrink-0 mb-1 shadow-sm"
                title="Create a new section template group"
              >
                <FolderPlus className="size-3.5" />
                New Group
              </Button>
            </div>

            <Card className="flex flex-col gap-3 px-3 shadow-none">
              {/* Section Assignment Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Text as="p" className="text-xs font-bold text-foreground">
                    Currently applied to:
                  </Text>
                  {assignedClasses.length === 0 ? (
                    <Text as="p" className="text-xs italic text-muted-foreground font-medium">
                      No sections currently assigned to this template
                    </Text>
                  ) : (
                    assignedClasses.map((c) => (
                      <Badge
                        key={c.class_id}
                        variant="outline"
                        size="sm"
                        className="font-bold bg-background text-[11px]"
                      >
                        {c.section_name}
                      </Badge>
                    ))
                  )}
                </div>

                {/* Quick Reassign Dropdown */}
                {otherClasses.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Select
                      value=""
                      onValueChange={(val) => {
                        const cid = Number(val);
                        if (cid) void handleReassignClass(cid, activeGroup);
                      }}
                      disabled={isReassigning}
                    >
                      <Select.Trigger className="h-7 text-xs min-w-48 bg-background shadow-none">
                        <Select.Value placeholder="Assign Section to Template..." />
                      </Select.Trigger>
                      <Select.Content>
                        {otherClasses.map((c) => (
                          <Select.Item key={c.class_id} value={String(c.class_id)}>
                            {c.section_name} ({c.period_template_group ? formatGroupName(c.period_template_group) : "Unassigned"})
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                )}
              </div>

              {isLoading ? (
                <Empty className="p-8">
                  <Empty.Content>
                    <Loader size="md" />
                    <Empty.Title className="text-sm">
                      Loading period templates from database...
                    </Empty.Title>
                  </Empty.Content>
                </Empty>
              ) : activeSlots.length === 0 ? (
                <Empty className="p-6 bg-amber-50/50 border-amber-800">
                  <Empty.Content>
                    <Empty.Icon className="size-8 text-amber-800">
                      <Clock className="size-8" />
                    </Empty.Icon>
                    <Empty.Title className="text-base">
                      No time slots configured for {formatGroupName(activeGroup)}.
                    </Empty.Title>
                    <Button size="sm" onClick={handleAddSlot} className="mt-2">
                      <Plus className="size-4 mr-1" /> Add First Slot
                    </Button>
                  </Empty.Content>
                </Empty>
              ) : (
                <div className="space-y-2">
                  {activeSlots.map((slot) => {
                    return (
                      <Card
                        key={`${slot.template_group}_${slot.display_order}_${slot.slot_id || slot.slot_name}`}
                        className={cn(
                          "p-3 flex flex-row items-center justify-between gap-4 w-full shadow-none",
                          slot.slot_type === "LUNCH"
                            ? "bg-sky-100/90"
                            : slot.slot_type === "RECESS"
                              ? "bg-amber-100/90"
                              : slot.slot_type === "HOMEROOM"
                                ? "bg-purple-100/90"
                                : "bg-card"
                        )}
                      >
                        {/* Editable Slot Label & Type */}
                        {slot.slot_type === "HOMEROOM" && <Sunrise className="size-4 text-purple-900 shrink-0" />}
                        {slot.slot_type === "RECESS" && <Coffee className="size-4 text-amber-900 shrink-0" />}
                        {slot.slot_type === "LUNCH" && <Utensils className="size-4 text-sky-900 shrink-0" />}
                        {slot.slot_type === "CLASS" && <Clock className="size-4 text-muted-foreground shrink-0" />}

                        <Input
                          type="text"
                          value={slot.slot_name}
                          onChange={(e) =>
                            handleSlotFieldChange(slot.slot_id ?? undefined, slot.display_order, "slot_name", e.target.value)
                          }
                          className="h-8 text-xs font-bold w-full bg-background shadow-none "
                          placeholder="Slot Label (e.g. Morning Recess)"
                        />

                        <Select
                          value={slot.slot_type}
                          onValueChange={(newType: any) => {
                            const isLocked = newType !== "CLASS";
                            handleSlotFieldChange(slot.slot_id ?? undefined, slot.display_order, "slot_type", newType);
                            handleSlotFieldChange(slot.slot_id ?? undefined, slot.display_order, "is_locked_break", isLocked);
                          }}
                        >
                          <Select.Trigger className="h-7 text-xs min-w-28 py-0 bg-background shadow-none">
                            <Select.Value />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Item value="CLASS">Class</Select.Item>
                            <Select.Item value="RECESS">Recess</Select.Item>
                            <Select.Item value="LUNCH">Lunch</Select.Item>
                            <Select.Item value="HOMEROOM">Homeroom</Select.Item>
                          </Select.Content>
                        </Select>

                        {/* Start and End Pickers */}
                        <div className="flex items-center gap-2">
                          <TimePickerSingle
                            className="shadow-none"
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
                          <Text as="p" className="text-xs font-bold">to</Text>
                          <TimePickerSingle
                            className="shadow-none"
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

                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={() => handleRemoveSlot(slot.display_order, slot.slot_id)}
                            className="h-7 w-7 p-0 text-destructive hover:bg-destructive hover:text-destructive-foreground ml-1 shadow-none"
                            title="Remove slot"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </Card>
                    );
                  })}

                  <div className="pt-2">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={handleAddSlot}
                      className="w-full border-dashed text-xs font-bold shadow-none"
                    >
                      <Plus className="size-4 mr-1.5 text-foreground" />
                      <span>Add Time Slot to {formatGroupName(activeGroup)}</span>
                    </Button>
                  </div>
                </div>
              )}
            </Card>

          </section>


          <Dialog.Footer position="static">
            <Button variant="outline" disabled={isSaving} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={isSaving}
              onClick={handleSaveClick}
            >
              <Save className="size-4 mr-2" />
              Save Break Timelines
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog >

      {/* Themed RetroUI Confirmation Modal */}
      < Dialog open={showConfirmModal} onOpenChange={(val) => { if (!val && !isSaving) setShowConfirmModal(false); }
      }>
        <Dialog.Content size="sm">
          <Dialog.Header position="static">
            <div className="flex items-center gap-2">
              <Text as="h5" className="text-lg font-sans font-bold">
                Confirm Period Template Update
              </Text>
            </div>
          </Dialog.Header>

          <section className="flex flex-col gap-3 p-5 text-sm">
            <Text as="p" className="font-normal text-foreground">
              Saving changes will update the master period template for{" "}
              <span className="font-bold">{formatGroupName(activeGroup)}</span>.
            </Text>
            <Text className="text-xs text-muted-foreground font-medium">
              This will update the bell schedule and apply new times across all matching subject loads and active timetables in this group.
            </Text>

          </section>

          <Dialog.Footer position="static">
            <Button
              variant="outline"
              disabled={isSaving}
              onClick={() => setShowConfirmModal(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={isSaving}
              onClick={() => void executeSave()}
            >
              <Save className="size-4 mr-1.5" />
              Confirm
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog >

      {/* Themed RetroUI New Template Group Modal */}
      < Dialog open={showNewGroupModal} onOpenChange={(val) => { if (!val) setShowNewGroupModal(false); }}>
        <Dialog.Content size="md">
          <Dialog.Header position="static">
            <div className="flex items-center gap-2">
              <FolderPlus className="size-5 shrink-0" />
              <Text as="h5" className="font-sans text-base font-bold">
                New Section Template Group
              </Text>
            </div>
          </Dialog.Header>

          <section className="flex flex-col gap-3 p-5 text-sm">
            <Text as="p" className="text-xs text-muted-foreground font-medium leading-relaxed">
              Enter a name for the new period template group (e.g. <code className="font-bold bg-muted px-1 border border-border rounded">SHS_TVL</code>, <code className="font-bold bg-muted px-1 border border-border rounded">REMEDIAL_SUMMER</code>). It will clone the base periods from <span className="font-bold">{formatGroupName(activeGroup)}</span>.
            </Text>
            {newGroupError && (
              <Alert status="error">
                <Alert.Description>{newGroupError}</Alert.Description>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label className="block text-xs font-bold">Group Name / Identifier:</Label>
              <Input
                value={newGroupNameInput}
                onChange={(e) => {
                  setNewGroupNameInput(e.target.value);
                  setNewGroupError(null);
                }}
                placeholder="e.g. SHS_TVL"
                className="w-full"
                autoFocus
              />
            </div>
          </section>

          <Dialog.Footer position="static">
            <Button
              variant="outline"
              onClick={() => setShowNewGroupModal(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAddGroup}
            >
              <Plus className="size-4 mr-1.5" />
              Create Group
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog >
    </>
  );
}

