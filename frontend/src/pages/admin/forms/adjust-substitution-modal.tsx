"use client";

import * as React from "react";
import { FormMessage } from "@/components/retroui/FormMessage";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { Button } from "@/components/admin/button";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Text } from "@/components/retroui/Text";
import { Badge } from "@/components/retroui/Badge";
import { useToast } from "@/components/retroui/Toast";
import { ApiRequestError, adjustSubstitutionEndDate, adjustBatchSubstitutionsEndDate, type TeacherSubstitution } from "@/lib/api";
import { Calendar, Layers, Loader2 } from "lucide-react";

export interface AdjustModalTarget {
  type: "single" | "batch";
  substitution?: TeacherSubstitution;
  batchId?: string;
  batchCount?: number;
  originalTeacherName?: string;
  substituteTeacherName?: string;
  startDate?: string;
  currentEndDate?: string | null;
}

interface AdjustSubstitutionModalProps {
  target: AdjustModalTarget;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AdjustSubstitutionModal({
  target,
  onClose,
  onSuccess,
}: AdjustSubstitutionModalProps) {
  const toast = useToast();
  const isBatch = target.type === "batch";
  const initialEndDate = isBatch ? (target.currentEndDate || "") : (target.substitution?.end_date || "");
  const startDate = isBatch ? (target.startDate || "") : (target.substitution?.start_date || "");

  const [endDate, setEndDate] = React.useState<string>(initialEndDate);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = React.useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (endDate && startDate && endDate < startDate) {
      setErrorMsg("End date cannot be earlier than start date.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      if (isBatch && target.batchId) {
        await adjustBatchSubstitutionsEndDate(target.batchId, endDate.trim() ? endDate : null);
      } else if (target.substitution) {
        await adjustSubstitutionEndDate(target.substitution.substitution_id, endDate.trim() ? endDate : null);
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to adjust substitution end date.";
      if (err instanceof ApiRequestError && (err.status === 400 || err.status === 422)) {
        setErrorMsg(message);
        setValidationAttempt((attempt) => attempt + 1);
      } else toast.error({ title: "Unable to update substitution end date", description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Content size="md">
      <Dialog.Header position="static">
        <div className="flex items-center gap-2">
          {isBatch && <Layers className="h-5 w-5 text-primary" />}
          <Text as="h5" className="font-sans text-lg font-bold">
            {isBatch
              ? `Adjust Program Leave End Date (${target.batchCount || 0} loads)`
              : "Adjust Substitution End Date"}
          </Text>
        </div>
      </Dialog.Header>

      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        <AdminValidationAlert message={errorMsg === "End date cannot be earlier than start date." ? null : errorMsg} attempt={validationAttempt} />
        <div className="p-3 bg-muted/40 rounded border space-y-2 text-sm">
          {!isBatch && target.substitution && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Class & Subject:</span>
              <span className="font-medium">
                {target.substitution.subject_name} ({target.substitution.section_name})
              </span>
            </div>
          )}
          {isBatch && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Scope:</span>
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                All {target.batchCount} Program Subject Loads
              </Badge>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Original Teacher:</span>
            <span className="font-medium">
              {isBatch ? target.originalTeacherName : target.substitution?.original_staff_name}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Substitute Teacher:</span>
            <span className="font-medium">
              {isBatch ? target.substituteTeacherName : target.substitution?.substitute_staff_name}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Start Date:</span>
            <span className="font-medium">{startDate}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Current End Date:</span>
            <Badge variant="outline">{initialEndDate || "Open-ended"}</Badge>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            <span>New End Date</span>
          </label>
          <Input
            id="adjust-substitution-end-date"
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setErrorMsg(null); }}
            min={startDate || undefined}
            aria-invalid={errorMsg === "End date cannot be earlier than start date."}
            aria-describedby={errorMsg === "End date cannot be earlier than start date." ? "adjust-substitution-end-date-error" : undefined}
          />
          {errorMsg === "End date cannot be earlier than start date." && <FormMessage id="adjust-substitution-end-date-error">{errorMsg}</FormMessage>}
          <p className="text-xs text-muted-foreground">
            {isBatch
              ? "Extends or shortens the coverage date across all loads in this batch. Leave blank for indefinite."
              : "You can extend or shorten the coverage date in advance. Leave blank for indefinite."}
          </p>
        </div>

        <Dialog.Footer position="static" className="pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              isBatch ? `Save for All ${target.batchCount} Loads` : "Save Changes"
            )}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  );
}
