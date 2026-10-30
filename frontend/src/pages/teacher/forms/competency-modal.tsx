import { useEffect, useState } from "react";
import { Loader2, Plus, Save, X } from "lucide-react";
import { FormMessage } from "@/components/retroui/FormMessage";
import { Button } from "@/components/teacher/button";
import { useToast } from "@/components/retroui/Toast";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import Field from "@/components/admin/classes/fields/Field";
import { apiFetch } from "@/lib/api";
import type { CompetencyItem } from "../subject-details/types";
import { useEditFormChanges } from "@/hooks/use-edit-form-changes";
import { NoChangesMessage } from "@/components/retroui/FormMessage";

interface CompetencyModalProps {
  open?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  onSaved?: (competency: CompetencyItem) => void;
  onSuccess?: (competency?: CompetencyItem) => Promise<void> | void;
  subjectId: number;
  editingCompetency?: CompetencyItem | null;
  initialData?: CompetencyItem | null;
}

export default function CompetencyModal({
  open,
  isOpen,
  onOpenChange,
  onClose,
  onSaved,
  onSuccess,
  subjectId,
  editingCompetency,
  initialData,
}: CompetencyModalProps) {
  const toast = useToast();
  const isModalOpen = open !== undefined ? open : (isOpen ?? false);
  const targetCompetency = editingCompetency || initialData || null;

  const [statement, setStatement] = useState("");
  const [competencyCode, setCompetencyCode] = useState("");
  const [description, setDescription] = useState("");
  const [targetHours, setTargetHours] = useState("0");
  const [orderIndex, setOrderIndex] = useState("1");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (targetCompetency) {
      setStatement(targetCompetency.statement || "");
      setCompetencyCode(targetCompetency.competency_code || "");
      setDescription(targetCompetency.description || "");
      setTargetHours(String(targetCompetency.target_hours || 0));
      setOrderIndex(String(targetCompetency.order_index || 1));
    } else {
      setStatement("");
      setCompetencyCode("");
      setDescription("");
      setTargetHours("0");
      setOrderIndex("1");
    }
    setError("");
  }, [targetCompetency, isModalOpen]);

  const changes = useEditFormChanges({
    enabled: !!targetCompetency,
    resetKey: `${isModalOpen}:${targetCompetency?.competency_id}`,
    initialValues: [targetCompetency?.statement?.trim(), targetCompetency?.competency_code?.trim(), targetCompetency?.description?.trim(), Number(targetCompetency?.target_hours) || 0, Number(targetCompetency?.order_index) || 1],
    values: [statement.trim(), competencyCode.trim(), description.trim(), Number(targetHours) || 0, Number(orderIndex) || 1],
  });
  const handleClose = () => {
    if (onOpenChange) onOpenChange(false);
    if (onClose) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changes.guardChanges()) return;
    if (!statement.trim()) {
      setError("Learning competency statement is required.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      if (targetCompetency) {
        const res = await apiFetch(`/api/v1/competencies/${targetCompetency.competency_id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            statement: statement.trim(),
            competency_code: competencyCode.trim() || null,
            description: description.trim() || null,
            target_hours: Number(targetHours) || 0,
            order_index: Number(orderIndex) || 1,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          const errorMsg = Array.isArray(errData?.detail)
            ? errData.detail.map((d: any) => d.msg || JSON.stringify(d)).join(", ")
            : (errData?.detail || "Failed to update competency.");
          throw new Error(errorMsg);
        }
        const updated = (await res.json()) as CompetencyItem;
        if (onSaved) onSaved(updated);
        if (onSuccess) await onSuccess(updated);
        toast.success({ title: "Competency updated" });
      } else {
        const parsedSubjectId = Number(subjectId);
        if (!parsedSubjectId || isNaN(parsedSubjectId)) {
          throw new Error("A valid Subject must be selected to create a competency.");
        }

        const res = await apiFetch("/api/v1/competencies/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject_id: parsedSubjectId,
            statement: statement.trim(),
            competency_code: competencyCode.trim() || null,
            description: description.trim() || null,
            target_hours: Number(targetHours) || 0,
            order_index: Number(orderIndex) || 1,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          const errorMsg = Array.isArray(errData?.detail)
            ? errData.detail.map((d: any) => d.msg || JSON.stringify(d)).join(", ")
            : (errData?.detail || "Failed to create competency.");
          throw new Error(errorMsg);
        }
        const created = (await res.json()) as CompetencyItem;
        if (onSaved) onSaved(created);
        if (onSuccess) await onSuccess(created);
        toast.success({ title: "Competency created" });
      }
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save competency.");
      toast.error({ title: "Failed to save competency", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isModalOpen} disablePointerDismissal={true} onOpenChange={(val) => !val && handleClose()}>
      <Dialog.Content size="lg">
        <Dialog.Header position="static">
          <div>
            <h2 className="font-sans text-xl font-bold">
              {targetCompetency ? "Edit Learning Competency" : "Add Learning Competency"}
            </h2>

          </div>
        </Dialog.Header>

        <form onSubmit={handleSubmit} noValidate>
          <section className="flex flex-col gap-4 p-4">
            {error && error !== "Learning competency statement is required." && <FormMessage>{error}</FormMessage>}

            <p className="text-sm font-normal text-muted-foreground">
              Define the learning standard used to group lessons and build the Table of Specifications
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="sm:col-span-3">
                <Field label="Competency Code">
                  <Input
                    value={competencyCode}
                    onChange={(e) => setCompetencyCode(e.target.value)}
                    placeholder="MELC Code (e.g. M7AL-IIa-1)"
                    className="w-full font-mono"
                  />
                </Field>
              </div>

              <Field label="Target Hours">
                <Input
                  type="number"
                  min="0"
                  value={targetHours}
                  onChange={(e) => setTargetHours(e.target.value)}
                  className="w-full"
                />
              </Field>
            </div>

            <Field label="Competency Statement" isRequired={true}>
              <textarea
                rows={3}
                value={statement}
                onChange={(e) => { setStatement(e.target.value); if (e.target.value.trim() && error === "Learning competency statement is required.") setError(""); }}
                aria-invalid={error === "Learning competency statement is required."}
                aria-describedby={error === "Learning competency statement is required." ? "competency-statement-error" : undefined}
                placeholder="e.g. Translates verbal phrases to mathematical expressions and vice versa."
                className="w-full resize-none rounded! border-2 border-border bg-background px-4 py-2 font-sans text-base font-normal shadow-md transition focus:outline-hidden focus:shadow-xs aria-[invalid=true]:border-destructive"
              />
              {error === "Learning competency statement is required." && <FormMessage id="competency-statement-error">{error}</FormMessage>}
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="sm:col-span-3">
                <Field label="Description">
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief term or unit note"
                    className="w-full"
                  />
                </Field>
              </div>

              <Field label="Order Index">
                <Input
                  type="number"
                  min="1"
                  value={orderIndex}
                  onChange={(e) => setOrderIndex(e.target.value)}
                  className="w-full"
                />
              </Field>
            </div>


          </section>

          <Dialog.Footer position="static">
            <NoChangesMessage message={changes.noChangesMessage} />
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              className="gap-2"
            >
              <X className="size-4" />
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || (!!targetCompetency && !changes.hasChanges)}
              className="gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : targetCompetency ? (
                <Save className="size-4" />
              ) : (
                <Plus className="size-4" />
              )}
              {isSubmitting
                ? "Saving..."
                : targetCompetency
                  ? "Save Changes"
                  : "Create Competency"}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}
