import { useEffect, useState } from "react";
import { Award, X } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { apiFetch } from "@/lib/api";
import type { CompetencyItem } from "./types";

interface CompetencyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (competency: CompetencyItem) => void;
  subjectId: number;
  editingCompetency?: CompetencyItem | null;
}

export default function CompetencyModal({
  isOpen,
  onClose,
  onSaved,
  subjectId,
  editingCompetency,
}: CompetencyModalProps) {
  const [statement, setStatement] = useState("");
  const [competencyCode, setCompetencyCode] = useState("");
  const [description, setDescription] = useState("");
  const [targetHours, setTargetHours] = useState("0");
  const [orderIndex, setOrderIndex] = useState("1");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editingCompetency) {
      setStatement(editingCompetency.statement || "");
      setCompetencyCode(editingCompetency.competency_code || "");
      setDescription(editingCompetency.description || "");
      setTargetHours(String(editingCompetency.target_hours || 0));
      setOrderIndex(String(editingCompetency.order_index || 1));
    } else {
      setStatement("");
      setCompetencyCode("");
      setDescription("");
      setTargetHours("0");
      setOrderIndex("1");
    }
    setError("");
  }, [editingCompetency, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statement.trim()) {
      setError("Learning competency statement is required.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      if (editingCompetency) {
        const res = await apiFetch(`/api/v1/competencies/${editingCompetency.competency_id}`, {
          method: "PUT",
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
          throw new Error(errData?.detail || "Failed to update competency.");
        }
        const updated = (await res.json()) as CompetencyItem;
        onSaved(updated);
      } else {
        const res = await apiFetch("/api/v1/competencies/", {
          method: "POST",
          body: JSON.stringify({
            subject_id: subjectId,
            statement: statement.trim(),
            competency_code: competencyCode.trim() || null,
            description: description.trim() || null,
            target_hours: Number(targetHours) || 0,
            order_index: Number(orderIndex) || 1,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.detail || "Failed to create competency.");
        }
        const created = (await res.json()) as CompetencyItem;
        onSaved(created);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save competency.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content className="max-w-lg border-2 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <Dialog.Header>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="size-5 text-primary" />
              <Dialog.Title className="text-xl font-bold">
                {editingCompetency ? "Edit Learning Competency" : "Add Learning Competency"}
              </Dialog.Title>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 hover:bg-gray-100 cursor-pointer"
            >
              <X className="size-5" />
            </button>
          </div>
          <Dialog.Description className="text-xs text-gray-600">
            Define the DepEd learning standard that will group lessons and power the Table of Specifications (TOS).
          </Dialog.Description>
        </Dialog.Header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          {error && (
            <div className="rounded border border-red-500 bg-red-50 p-2 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs font-bold text-gray-800">
                Competency Code <span className="text-gray-500 font-normal">(e.g. M7AL-IIa-1)</span>
              </label>
              <Input
                value={competencyCode}
                onChange={(e) => setCompetencyCode(e.target.value)}
                placeholder="Optional MELC Code"
                className="h-9 text-xs border-black shadow-none font-mono"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-gray-800">
                Target Hours
              </label>
              <Input
                type="number"
                min="0"
                value={targetHours}
                onChange={(e) => setTargetHours(e.target.value)}
                className="h-9 text-xs border-black shadow-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-gray-800">
              Competency Statement <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="e.g. Translates verbal phrases to mathematical expressions and vice versa."
              className="w-full rounded border-2 border-black p-2 text-xs font-medium shadow-none focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs font-bold text-gray-800">
                Description / Notes <span className="text-gray-500 font-normal">(Optional)</span>
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief quarter or unit note"
                className="h-9 text-xs border-black shadow-none"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-gray-800">
                Order Index
              </label>
              <Input
                type="number"
                min="1"
                value={orderIndex}
                onChange={(e) => setOrderIndex(e.target.value)}
                className="h-9 text-xs border-black shadow-none"
              />
            </div>
          </div>

          <div className="mt-2 flex justify-end gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
              className="border-black font-semibold hover:bg-gray-100"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isSubmitting}
              className="border-black bg-primary font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:opacity-90"
            >
              {isSubmitting ? "Saving..." : editingCompetency ? "Save Changes" : "Create Competency"}
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}
