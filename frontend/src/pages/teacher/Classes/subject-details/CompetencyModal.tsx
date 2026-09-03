import { useEffect, useState } from "react";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { apiFetch } from "@/lib/api";
import type { CompetencyItem } from "./types";

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

  const handleClose = () => {
    if (onOpenChange) onOpenChange(false);
    if (onClose) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      }
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save competency.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isModalOpen} disablePointerDismissal={true} onOpenChange={(val) => !val && handleClose()}>
      <Dialog.Content size="md">
        <Dialog.Header position="static">
          <div>
            <h2 className="font-sans text-xl font-bold">
              {targetCompetency ? "Edit Learning Competency" : "Add Learning Competency"}
            </h2>
            <p className="text-sm font-normal">
              Define the learning standard used to group lessons and build the Table of Specifications.
            </p>
          </div>
        </Dialog.Header>

        <form onSubmit={handleSubmit}>
          <section className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto p-4">
            {error && (
              <Alert status="error">
                <Alert.Description>{error}</Alert.Description>
              </Alert>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span>Competency Code <span className="text-muted-foreground">(e.g. M7AL-IIa-1)</span></span>
                <Input
                  value={competencyCode}
                  onChange={(e) => setCompetencyCode(e.target.value)}
                  placeholder="Optional MELC Code"
                  className="w-full font-mono"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span>Target Hours</span>
                <Input
                  type="number"
                  min="0"
                  value={targetHours}
                  onChange={(e) => setTargetHours(e.target.value)}
                  className="w-full"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span>Competency Statement <span className="text-destructive">*</span></span>
              <textarea
                required
                rows={3}
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="e.g. Translates verbal phrases to mathematical expressions and vice versa."
                className="w-full resize-none rounded border-2 border-border bg-background px-4 py-2 text-sm shadow-md transition focus:outline-hidden focus:shadow-xs"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span>Description / Notes <span className="text-muted-foreground">(Optional)</span></span>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief quarter or unit note"
                  className="w-full"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span>Order Index</span>
                <Input
                  type="number"
                  min="1"
                  value={orderIndex}
                  onChange={(e) => setOrderIndex(e.target.value)}
                  className="w-full"
                />
              </label>
            </div>
          </section>

          <Dialog.Footer position="static">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
            >
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
