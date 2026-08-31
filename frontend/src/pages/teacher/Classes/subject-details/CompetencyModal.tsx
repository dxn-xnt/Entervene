import { useEffect, useState } from "react";
import { Award } from "lucide-react";
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
      <Dialog.Content
        size="md"
        className="w-[95vw] max-w-xl border-2 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-0 overflow-hidden"
      >
        <Dialog.Header className="bg-[#F6E9B2] border-black">
          <div className="flex items-center gap-2.5">
            <Award className="size-6 text-black" />
            <h2 className="text-xl font-black text-black">
              {targetCompetency ? "Edit Learning Competency" : "Add Learning Competency"}
            </h2>
          </div>
        </Dialog.Header>

        <div className="bg-yellow-50/70 border-b border-black/10 px-6 py-2.5">
          <p className="text-xs text-black/70 font-medium">
            Define the DepEd learning standard that will group lessons and power the Table of Specifications (TOS).
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
          {error && (
            <div className="rounded border-2 border-red-500 bg-red-50 p-3 text-xs font-bold text-red-700">
              {error}
            </div>
          )}

          {/* Row 1: MELC Code & Target Hours */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 flex flex-col gap-1.5">
              <label className="text-xs font-bold text-gray-900">
                Competency Code <span className="text-gray-500 font-normal">(e.g. M7AL-IIa-1)</span>
              </label>
              <Input
                value={competencyCode}
                onChange={(e) => setCompetencyCode(e.target.value)}
                placeholder="Optional MELC Code"
                className="h-10 text-xs border-2 border-black shadow-none font-mono bg-white"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-gray-900">
                Target Hours
              </label>
              <Input
                type="number"
                min="0"
                value={targetHours}
                onChange={(e) => setTargetHours(e.target.value)}
                className="h-10 text-xs border-2 border-black shadow-none bg-white font-semibold"
              />
            </div>
          </div>

          {/* Row 2: Competency Statement */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-gray-900">
              Competency Statement <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="e.g. Translates verbal phrases to mathematical expressions and vice versa."
              className="w-full rounded-md border-2 border-black p-3 text-xs font-medium shadow-none focus:outline-none focus:ring-2 focus:ring-primary bg-white resize-none"
            />
          </div>

          {/* Row 3: Description / Notes & Order Index */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 flex flex-col gap-1.5">
              <label className="text-xs font-bold text-gray-900">
                Description / Notes <span className="text-gray-500 font-normal">(Optional)</span>
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief quarter or unit note"
                className="h-10 text-xs border-2 border-black shadow-none bg-white"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-gray-900">
                Order Index
              </label>
              <Input
                type="number"
                min="1"
                value={orderIndex}
                onChange={(e) => setOrderIndex(e.target.value)}
                className="h-10 text-xs border-2 border-black shadow-none bg-white font-semibold"
              />
            </div>
          </div>

          {/* Dialog Action Buttons */}
          <div className="mt-4 pt-4 border-t-2 border-black/10 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={isSubmitting}
              className="border-2 border-black bg-white hover:bg-gray-100 font-bold px-4 text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isSubmitting}
              className="border-2 border-black bg-primary hover:opacity-90 text-black font-bold px-5 text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              {isSubmitting
                ? "Saving..."
                : targetCompetency
                ? "Save Changes"
                : "Create Competency"}
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}
