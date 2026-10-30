import { useState } from "react";
import { formSnapshot } from "@/lib/form-changes";

export function useEditFormChanges({ initialValues, values, enabled = true, resetKey = "" }: {
  initialValues: unknown;
  values: unknown;
  enabled?: boolean;
  resetKey?: string | number;
}) {
  const original = formSnapshot(initialValues);
  const current = formSnapshot(values);
  const context = `${enabled}:${resetKey}:${original}`;
  const [state, setState] = useState({ context, current, saved: null as string | null, notice: false });
  // Adjust derived state during rendering so record changes and reopens cannot
  // briefly expose the previous record's save state or neutral notice.
  if (state.context !== context || state.current !== current) {
    setState({ context, current, saved: state.context === context ? state.saved : null, notice: false });
  }
  const baseline = state.context === context ? state.saved ?? original : original;
  const hasChanges = enabled && current !== baseline;

  return {
    hasChanges,
    noChangesMessage: !hasChanges && state.context === context && state.current === current && state.notice ? "No changes to save." : null,
    guardChanges() {
      if (!enabled || hasChanges) return true;
      setState({ ...state, context, current, notice: true });
      return false;
    },
    markSaved() {
      setState({ context, current, saved: current, notice: false });
    },
  };
}
