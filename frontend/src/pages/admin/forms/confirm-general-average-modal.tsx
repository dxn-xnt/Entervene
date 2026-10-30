"use client";

import * as React from "react";
import { FormMessage } from "@/components/retroui/FormMessage";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { Button } from "@/components/admin/button";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Text } from "@/components/retroui/Text";
import { Badge } from "@/components/retroui/Badge";
import type { YearGeneralAveragePolicy } from "@/lib/settings-api";

export type GeneralAverageAction =
  | "edit"
  | "confirm_legacy"
  | "initialize_manual"
  | "copy_previous";

export interface ConfirmGeneralAverageModalProps {
  policy: YearGeneralAveragePolicy | null;
  yearLabel: string;
  threshold: string;
  onThresholdChange?: React.Dispatch<React.SetStateAction<string>> | ((val: string) => void);
  isSaving?: boolean;
  onClose: () => void;
  onConfirm: (
    action: GeneralAverageAction,
    reason: string,
    thresholdValue?: string
  ) => Promise<void>;
}

export default function ConfirmGeneralAverageModal({
  policy,
  yearLabel,
  threshold,
  isSaving = false,
  onClose,
  onConfirm,
}: ConfirmGeneralAverageModalProps) {
  const isConfigured = Boolean(policy?.configured);
  const [isManualMode, setIsManualMode] = React.useState(
    isConfigured || !policy?.legacy_proposal
  );
  const [thresholdValue, setThresholdValue] = React.useState(threshold || "");
  const [reason, setReason] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = React.useState(0);

  const handleSubmit = async (action: GeneralAverageAction) => {
    const trimmedReason = reason.trim();
    if (action === "edit" || action === "initialize_manual") {
      const num = parseFloat(thresholdValue);
      if (!thresholdValue || isNaN(num) || num < 0 || num > 100) {
        setValidationError("Passing threshold must be between 0 and 100.");
        setValidationAttempt((prev) => prev + 1);
        return;
      }
    }

    if (!trimmedReason || !confirmed) {
      setValidationError("Select a year, enter an audit reason, and confirm this change.");
      setValidationAttempt((prev) => prev + 1);
      return;
    }

    setValidationError(null);
    try {
      await onConfirm(action, trimmedReason, thresholdValue);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save threshold.";
      setValidationError(msg);
      setValidationAttempt((prev) => prev + 1);
    }
  };

  return (
    <Dialog.Content size="md">
      <Dialog.Header position="static">
        <Text as="h5" className="font-sans text-lg font-bold">
          {isConfigured
            ? "Update General Average Passing Grade"
            : "Configure General Average Passing Grade"}
        </Text>
      </Dialog.Header>

      <div className="flex flex-col gap-4 p-4 text-sm">
        <AdminValidationAlert
          message={
            validationError === "Select a year, enter an audit reason, and confirm this change."
              ? null
              : validationError
          }
          attempt={validationAttempt}
        />

        <div className="flex flex-col gap-2 rounded border-2 border-black bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-muted-foreground">Academic Year:</span>
            <Badge variant="outline" className="font-bold">
              {yearLabel || "Not specified"}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-muted-foreground">Current Status:</span>
            <span className="font-medium text-xs">
              {isConfigured
                ? `Confirmed: ${policy?.threshold}%`
                : "Unconfigured for this academic year"}
            </span>
          </div>
          <Text as="p" className="text-xs text-muted-foreground mt-1">
            Numeric grades stay unchanged; displayed Passed/Failed may change while the year is open.
          </Text>
        </div>

        {!isConfigured && policy?.legacy_error ? (
          <p role="alert" className="text-sm text-red-700">
            {policy.legacy_error}
          </p>
        ) : null}

        {!isConfigured && !policy?.legacy_proposal ? (
          <p className="text-sm">
            No validated legacy proposal is available. Enter a grade for this year, give an audit reason, and confirm it explicitly.
          </p>
        ) : null}

        {/* Passing Threshold input when manual configuration or editing is active */}
        {(isConfigured || isManualMode) && (
          <div className="flex flex-col gap-1">
            <label htmlFor="modal-passing-threshold" className="text-sm font-semibold">
              Passing Threshold
            </label>
            <Input
              id="modal-passing-threshold"
              aria-label="Passing Threshold"
              className="w-full transition-all focus:shadow-md focus-visible:shadow-md sm:w-40"
              type="number"
              placeholder="0-100"
              min={0}
              max={100}
              step="0.01"
              value={thresholdValue}
              disabled={isSaving}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setThresholdValue(e.target.value);
                if (validationError === "Passing threshold must be between 0 and 100.") {
                  setValidationError(null);
                }
              }}
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="average-audit-reason" className="text-sm font-semibold">
            Audit reason
          </label>
          <Input
            id="average-audit-reason"
            aria-label="Audit reason"
            placeholder="e.g. Approved by Academic Council"
            value={reason}
            disabled={isSaving}
            aria-invalid={
              validationError === "Select a year, enter an audit reason, and confirm this change." &&
              !reason.trim()
            }
            aria-describedby={
              validationError === "Select a year, enter an audit reason, and confirm this change." &&
              !reason.trim()
                ? "average-audit-reason-error"
                : undefined
            }
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setReason(event.target.value);
              if (event.target.value.trim() && confirmed) {
                setValidationError(null);
              }
            }}
          />
          {validationError === "Select a year, enter an audit reason, and confirm this change." &&
            !reason.trim() && (
              <FormMessage id="average-audit-reason-error">
                Enter an audit reason.
              </FormMessage>
            )}
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <Checkbox
            checked={confirmed}
            disabled={isSaving}
            onCheckedChange={(checked) => {
              const isChecked = checked === true;
              setConfirmed(isChecked);
              if (isChecked && reason.trim()) {
                setValidationError(null);
              }
            }}
          />
          I confirm this year-specific policy action.
        </label>

        {validationError === "Select a year, enter an audit reason, and confirm this change." &&
          !confirmed && (
            <FormMessage>Confirm this policy action.</FormMessage>
          )}

        {!isConfigured ? (
          <div className="flex flex-col gap-2 pt-2 border-t-2 border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Available Policy Actions
            </span>

            {policy?.legacy_proposal ? (
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={() => void handleSubmit("confirm_legacy")}
              >
                Confirm legacy proposal ({policy.legacy_proposal}%)
              </Button>
            ) : null}

            {!policy?.legacy_proposal ? (
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={() => void handleSubmit("initialize_manual")}
              >
                Set initial passing grade manually
              </Button>
            ) : !isManualMode ? (
              <Button
                variant="ghost"
                className="text-xs text-muted-foreground underline justify-start p-0 h-auto"
                disabled={isSaving}
                onClick={() => setIsManualMode(true)}
              >
                Or enter passing grade manually instead
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={() => void handleSubmit("initialize_manual")}
              >
                Set initial passing grade manually
              </Button>
            )}

            {policy?.previous_academic_year_id ? (
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={() => void handleSubmit("copy_previous")}
              >
                Copy from Previous Academic Year
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Dialog.Footer position="static">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={isSaving}
        >
          Cancel
        </Button>
        {isConfigured ? (
          <Button
            type="button"
            onClick={() => void handleSubmit("edit")}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Threshold"}
          </Button>
        ) : null}
      </Dialog.Footer>
    </Dialog.Content>
  );
}
