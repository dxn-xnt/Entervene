import { useEffect, useMemo, useState } from "react";
import { ApiRequestError, getClassDetail, getClassFormOptions, updateClass } from "@/lib/api";
import type { AdviserOption, ClassDetailResponse, ClassFormOptions, UpdateClassRequest } from "@/types/adminClasses";
import Field from "../fields/Field";
import SelectField from "../fields/SelectField";
import { retroButton } from "../utils";
import ModalShell from "./ModalShell";

export default function EditClassModal({
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
  const [adviserStaffId, setAdviserStaffId] = useState(initialClass?.adviser?.staff_id ?? "");
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
        setAdviserStaffId(detail.adviser?.staff_id ?? "");
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
    const currentAdviserId = classDetail.adviser?.staff_id ?? "";
    if (adviserStaffId !== currentAdviserId) payload.adviser_staff_id = adviserStaffId || null;

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
      setAdviserStaffId(updatedClass.adviser?.staff_id ?? "");
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
          <button className={retroButton()} onClick={onClose}>Back to Classes</button>
        </StatePanel>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3">
            <Field label="Academic Year">
              <input
                readOnly
                value={classDetail.academic_year.year_label}
                className="h-10 rounded-md border border-black bg-black/5 px-3 text-sm text-black/70"
              />
            </Field>
            <Field label="Academic Level">
              <input
                readOnly
                value={classDetail.academic_level.level_name}
                className="h-10 rounded-md border border-black bg-black/5 px-3 text-sm text-black/70"
              />
            </Field>
            <Field label="Section Name">
              <input
                value={sectionName}
                onChange={(event) => {
                  setSectionName(event.target.value);
                  setSaveError("");
                  setSaveSuccess("");
                }}
                className="h-10 rounded-md border border-black bg-[#fffdf5] px-3 text-sm"
                placeholder="Section name"
              />
            </Field>
            <Field label="Class Adviser">
              <SelectField
                value={adviserStaffId}
                onChange={(value) => {
                  setAdviserStaffId(value);
                  setSaveError("");
                  setSaveSuccess("");
                }}
              >
                <option value="">No adviser assigned</option>
                {adviserOptions.map((adviser) => (
                  <option key={adviser.staff_id} value={adviser.staff_id}>
                    {adviserName(adviser)}
                  </option>
                ))}
              </SelectField>
              <p className="mt-1 text-[11px] font-semibold text-black/60">
                {classDetail.adviser
                  ? "Choose No adviser assigned to make this class temporarily unassigned."
                  : adviserOptions.length
                    ? "This class has no adviser. Select an available teacher to assign one."
                    : "This class has no adviser, and no available teachers can be assigned right now."}
              </p>
            </Field>
          </div>

          {saveError && (
            <div className="rounded-md border border-red-700 bg-red-50 p-3 text-sm font-semibold text-red-800">
              {saveError}
            </div>
          )}
          {saveSuccess && (
            <div className="rounded-md border border-black bg-[#d8efca] p-3 text-sm font-semibold">
              {saveSuccess}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button disabled={saving} className={retroButton("disabled:cursor-not-allowed disabled:opacity-50")} onClick={onClose}>
              Cancel
            </button>
            <button
              disabled={saving}
              className={retroButton("bg-[#79bd80] disabled:cursor-not-allowed disabled:opacity-50")}
              onClick={saveClass}
            >
              {saving ? "Saving changes..." : "Save Changes"}
            </button>
          </div>
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
    <div className="grid gap-3 rounded-md border border-black bg-[#fff8d7] p-5 text-sm">
      <p className="font-bold">{message}</p>
      {detail && detail !== message && <p className="text-xs text-black/70">{detail}</p>}
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
