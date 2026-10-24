"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiRequestError, getClassDetail, getClassFormOptions, updateClass } from "@/lib/api";
import type { AdviserOption, ClassDetailResponse, ClassFormOptions, UpdateClassRequest } from "@/types/adminClasses";
import Field from "@/components/admin/classes/fields/Field";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";
import { FormMessage } from "@/components/retroui/FormMessage";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { RoleBadge } from "@/components/role-badge";

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
  const [pathwayId, setPathwayId] = useState(initialClass?.pathway_id == null ? "__none__" : String(initialClass.pathway_id));
  const [sectionName, setSectionName] = useState(initialClass?.section_name ?? "");
  const [adviserStaffId, setAdviserStaffId] = useState(initialClass?.adviser?.staff_id || "__none__");
  const [loading, setLoading] = useState(!initialClass);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [validationAttempt, setValidationAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadEditData() {
      setLoading(true);
      setLoadError("");
      try {
        const detail = initialClass ?? await getClassDetail(classId);
        const formOptions = await getClassFormOptions(detail.academic_year.academic_year_id);
        if (cancelled) return;
        setClassDetail(detail);
        setOptions(formOptions);
        setPathwayId(detail.pathway_id == null ? "__none__" : String(detail.pathway_id));
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

  const officialSections = (options?.official_sections ?? []).filter((section) =>
    section.academic_level_id === classDetail?.academic_level.academic_level_id
    && ((section.is_active && !section.has_class) || section.section_name === classDetail?.section_name)
  );

  async function saveClass() {
    if (!classDetail || saving) return;
    const trimmedSectionName = sectionName.trim();
    if (!trimmedSectionName) {
      setSaveError("Section name is required.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }

    const payload: UpdateClassRequest = {};
    if (trimmedSectionName !== classDetail.section_name) payload.section_name = trimmedSectionName;
    const currentAdviserId = classDetail.adviser?.staff_id || "__none__";
    if (adviserStaffId !== currentAdviserId) payload.adviser_staff_id = adviserStaffId === "__none__" ? null : adviserStaffId;
    const currentPathwayId = classDetail.pathway_id == null ? "__none__" : String(classDetail.pathway_id);
    if (pathwayId !== currentPathwayId) {
      if (classDetail.academic_level.requires_pathway && pathwayId === "__none__") {
        setSaveError("Select an enabled pathway for this academic level.");
        setValidationAttempt((attempt) => attempt + 1);
        return;
      }
      payload.pathway_id = pathwayId === "__none__" ? null : Number(pathwayId);
    }

    if (!Object.keys(payload).length) {
      setSaveError("No changes to save.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const updatedClass = await updateClass(classDetail.class_id, payload);
      setClassDetail(updatedClass);
      setSectionName(updatedClass.section_name);
      setAdviserStaffId(updatedClass.adviser?.staff_id || "__none__");
      setPathwayId(updatedClass.pathway_id == null ? "__none__" : String(updatedClass.pathway_id));
      onSaved(updatedClass);
    } catch (error: unknown) {
      setSaveError(updateErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content size="lg">
        <Dialog.Header>
          <Text as="h5" className="font-sans text-xl font-bold">
            Edit Class
          </Text>
        </Dialog.Header>

        {loading ? (
          <div className="p-6">
            <StatePanel message="Loading class details..." />
          </div>
        ) : loadError || !classDetail || !options ? (
          <div className="p-6">
            <StatePanel message="Unable to load class details." detail={loadError}>
              <Button variant="outline" onClick={onClose}>
                Back to Classes
              </Button>
            </StatePanel>
          </div>
        ) : (
          <>
            <section className="flex flex-col gap-4 p-5">
              <AdminValidationAlert
                message={saveError === "Section name is required." || saveError === "Select an enabled pathway for this academic level." ? null : saveError}
                attempt={validationAttempt}
                firstInvalidFieldId={saveError === "Section name is required." ? "edit-class-section-name" : undefined}
              />
              <div className="grid gap-4">
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
                  <Select value={sectionName} onValueChange={(name) => {
                    const selected = officialSections.find((section) => section.section_name === name);
                    setSectionName(name);
                    setPathwayId(selected?.pathway_id == null ? "__none__" : String(selected.pathway_id));
                    setSaveError("");
                  }}>
                    <Select.Trigger id="edit-class-section-name" aria-invalid={saveError === "Section name is required."} aria-describedby={saveError === "Section name is required." ? "edit-class-section-error" : undefined} className="w-full text-base aria-[invalid=true]:border-destructive"><Select.Value placeholder="Select official section" /></Select.Trigger>
                    <Select.Content><Select.Group>
                      {officialSections.map((section) => <Select.Item key={section.id} value={section.section_name}>{section.section_name}{section.pathway_name ? ` — ${section.pathway_name}` : ""}</Select.Item>)}
                      {!officialSections.some((section) => section.section_name === classDetail.section_name) && <Select.Item value={classDetail.section_name} disabled>{classDetail.section_name} (historical)</Select.Item>}
                    </Select.Group></Select.Content>
                  </Select>
                  {saveError === "Section name is required." && <FormMessage id="edit-class-section-error">{saveError}</FormMessage>}
                </Field>

                {classDetail.academic_level.grade_level >= 11 && (
                  <Field label="Academic Pathway">
                    <Input readOnly value={officialSections.find((section) => section.section_name === sectionName)
                      ? officialSections.find((section) => section.section_name === sectionName)?.pathway_name ?? "No pathway assigned"
                      : classDetail.pathway?.name ?? "No pathway assigned"} className="bg-muted/50 text-muted-foreground text-base" />
                    {!classDetail.academic_level.requires_pathway && (
                      <Text as="p" className="mt-1 text-xs text-muted-foreground">This grade does not require a pathway in this academic year.</Text>
                    )}
                    {saveError === "Select an enabled pathway for this academic level." && <FormMessage>{saveError}</FormMessage>}
                  </Field>
                )}

                <Field label="Class Adviser">
                  <Select
                    value={adviserStaffId}
                    onChange={(event) => {
                      setAdviserStaffId(event.target.value);
                      setSaveError("");
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
                            <span className="flex items-center gap-2">
                              <span className="truncate">{adviserName(adviser)}</span>
                              <RoleBadge role="teacher" />
                            </span>
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

            </section>

            <Dialog.Footer>
              <Button variant="outline" disabled={saving} onClick={onClose}>
                Cancel
              </Button>
              <Button variant="default" disabled={saving} onClick={saveClass}>
                Save Changes
              </Button>
            </Dialog.Footer>
          </>
        )}
      </Dialog.Content>
    </Dialog>
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
    <div className="grid gap-3 rounded border-2 border-border bg-card p-5 text-sm">
      <p className="font-bold">{message}</p>
      {detail && detail !== message && <p className="text-xs text-muted-foreground">{detail}</p>}
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
