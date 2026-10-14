import { X } from "lucide-react";
import { dialogHeaderCloseButtonClassName } from "@/components/retroui/Dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";

export function StudentDialogCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            className={dialogHeaderCloseButtonClassName}
            aria-label="Close modal"
          >
            <X className="size-4" />
          </button>
        }
      />
      <TooltipContent>Close modal</TooltipContent>
    </Tooltip>
  );
}
