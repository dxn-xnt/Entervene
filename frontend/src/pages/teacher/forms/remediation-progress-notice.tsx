import { Plus } from "lucide-react";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/teacher/button";
import {
  remediationProgressMessage,
  type RemediationProgressState,
} from "./remediation-progress-status";

export function RemediationProgressNotice({
  state,
  onAddAnother,
}: {
  state: RemediationProgressState;
  onAddAnother: () => void;
}) {
  return (
    <Alert status={state === "CAN_ADD_ANOTHER" ? "success" : "info"} className="rounded!">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{remediationProgressMessage[state]}</p>
        {state === "CAN_ADD_ANOTHER" && (
          <Button size="sm" onClick={onAddAnother}>
            <Plus className="mr-1.5 size-3.5" />
            Add Another Remediation Activity
          </Button>
        )}
      </div>
    </Alert>
  );
}
