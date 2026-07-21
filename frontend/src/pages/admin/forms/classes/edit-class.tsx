"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiRequestError, getClassDetail, getClassFormOptions, updateClass } from "@/lib/api";
import type { AdviserOption, ClassDetailResponse, ClassFormOptions, UpdateClassRequest } from "@/types/adminClasses";
import Field from "@/components/admin/classes/fields/Field";
import ModalShell from "./modal-shell";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";

export default function EditClass({
  classId,
  initialClass,
  onClose,
  onSaved,
}: {
  classId: string | number;
  initialClass?: ClassDetailResponse | null;
  onClose: () => void;
  onSaved: (updatedClass: ClassDetailResponse) => void;
}) {
  const [classDetail, setClassDetail] = useState<ClassDetailResponse | null>(initialClass ?? null);
  const [options, setOptions] = useState<ClassFormOptions | null>(null);
  const [sectionName, setSectionName] = useState(initialClass?.section_name ?? "");
  const [adviserStaffId, setAdviserStaffId] = useState(initialClass?.adviser?.staff_id || "__none__");
  const [loading, setLoading] = useState(!initialClass);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadEditData() {
      setLoading(true);
      setLoadError("");
      try {
        const [detail, formOptions] = await Promise.all([
          initialClass ? Promise.resolve(initialClass) : getClassDetail(classId),
          getClassFormOptions(),
        ]);
        if (cancelled) return;
        setClassDetail(detail);
        setOptions(formOptions);
        setSectionName(detail.section_name);
        setAdviserStaffId(detail.adviser?.staff_id || "__none__");
      } catch (error: unknown) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Unable to load class details.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadEditData();

    return () => {
      cancelled = true;
    };
  }, [classId, initialClass]);

  const adviserOptions = useMemo(() => {
    const advisers = new Map<string, AdviserOption>();
    if (classDetail?.adviser) advisers.set(classDetail.adviser.staff_id, classDetail.adviser);
    options?.eligible_advisers.forEach((adviser) => advisers.set(adviser.staff_id, adviser));
    return Array.from(advisers.values()).sort((a, b) => adviserName(a).localeCompare(adviserName(b)));
  }, [classDetail, options]);

  async function saveClass() {
    if (!classDetail || saving) return;
    const trimmedSectionName = sectionName.trim();
    if (!trimmedSectionName) {
      setSaveError("Section name is required.");
      return;
    }

    const payload: UpdateClassRequest = {};
    if (trimmedSectionName !== classDetail.section_name) payload.section_name = trimmedSectionName;
    const currentAdviserId = classDetail.adviser?.staff_id || "__none__";
    if (adviserStaffId !== currentAdviserId) payload.adviser_staff_id = adviserStaffId === "__none__" ? null : adviserStaffId;

    if (!Object.keys(payload).length) {
      setSaveError("No changes to save.");
      return;
    }

    setSaving(true);
    setSaveError("");
    setSaveSuccess("");
    try {
      const updatedClass = await updateClass(classDetail.class_id, payload);
      setClassDetail(updatedClass);
      setSectionName(updatedClass.section_name);
      setAdviserStaffId(updatedClass.adviser?.staff_id || "__none__");
      setSaveSuccess("Class updated successfully.");
      onSaved(updatedClass);
    } catch (error: unknown) {
      setSaveError(updateErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Edit Class" onClose={onClose}>
      {loading ? (
        <StatePanel message="Loading class details..." />
      ) : loadError || !classDetail || !options ? (
        <StatePanel message="Unable to load class details." detail={loadError}>
          <Button variant={"outline"} onClick={onClose}>Back to Classes</Button>
        </StatePanel>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3">
            <Field label="Academic Year">
              <Input
                readOnly
                value={classDetail.academic_year.year_label}
                className="bg-muted/50 text-muted-foreground text-base"
              />
            </Field>

            <Field label="Academic Level">
              <Input
                readOnly
                value={classDetail.academic_level.level_name}
                className="bg-muted/50 text-muted-foreground text-base"
              />
            </Field>

            <Field label="Section Name">
              <Input
                className="text-base"
                value={sectionName}
                onChange={(event) => {
                  setSectionName(event.target.value);
                  setSaveError("");
                  setSaveSuccess("");
                }}
                placeholder="Section name"
              />
            </Field>

            <Field label="Class Adviser">
              <Select
                className="text-base"
                value={adviserStaffId}
                onChange={(event) => {
                  setAdviserStaffId(event.target.value);
                  setSaveError("");
                  setSaveSuccess("");
                }}
              >
                <Select.Trigger className="w-full text-base">
                  <Select.Value placeholder="Select class adviser..." />
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    <Select.Item value="__none__">No adviser assigned</Select.Item>
                    {adviserOptions.map((adviser) => (
                      <Select.Item key={adviser.staff_id} value={adviser.staff_id}>
                        {adviserName(adviser)}
                      </Select.Item>
                    ))}
                  </Select.Group>
                </Select.Content>
              </Select>

              <Text as="p" className="mt-1 text-xs text-muted-foreground font-medium">
                {classDetail.adviser
                  ? "Choose No adviser assigned to make this class temporarily unassigned."
                  : adviserOptions.length
                    ? "This class has no adviser. Select an available teacher to assign one."
                    : "This class has no adviser, and no available teachers can be assigned right now."}
              </Text>
            </Field>
          </div>

          {saveError && (
            <div className="rounded-md border-2 border-destructive bg-destructive/10 p-3 text-sm font-semibold text-destructive">
              {saveError}
            </div>
          )}

          {saveSuccess && (
            <div className="rounded-md border-2 border-primary bg-primary/10 p-3 text-sm font-semibold text-primary">
              {saveSuccess}
            </div>
          )}

          <Dialog.Footer className="px-0 pt-2 border-t-0">
            <Button variant={"outline"} disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={"default"}
              disabled={saving}
              onClick={saveClass}
            >
              {saving ? "Saving changes..." : "Save Changes"}
            </Button>
          </Dialog.Footer>
        </div>
      )}
    </ModalShell>
  );
}

function adviserName(adviser: AdviserOption) {
  return [adviser.first_name, adviser.middle_name, adviser.last_name, adviser.suffix].filter(Boolean).join(" ");
}

function updateErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) return error.message || "Unable to update class.";
  if (error instanceof Error) return error.message || "Unable to update class.";
  return "Unable to update class.";
}

function StatePanel({ message, detail, children }: { message: string; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-3 rounded-md border-2 border-border bg-card p-5 text-sm">
      <p className="font-bold">{message}</p>
      {detail && detail !== message && <p className="text-xs text-muted-foreground">{detail}</p>}
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
