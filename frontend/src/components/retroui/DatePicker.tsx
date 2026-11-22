import { useState } from "react";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Input } from "./Input";
import { Calendar } from "./Calendar";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  id?: string;
  includeTime?: boolean;
  "aria-label"?: string;
  value: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

// Parse date-only values locally so selecting a date never shifts its timezone.
function parseDate(value?: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("T")[0].split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function DatePicker({ id, value, onValueChange, min, max, disabled, required, className, includeTime = false, ...aria }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseDate(value);
  const minimum = parseDate(min);
  const maximum = parseDate(max);
  const minDatePart = min?.includes("T") ? min.split("T")[0] : undefined;
  const minTimePart = min?.includes("T") ? min.split("T")[1] : undefined;
  const selectedDatePart = value ? value.split("T")[0] : "";
  const timeMin =
    minDatePart && minTimePart && selectedDatePart === minDatePart
      ? minTimePart
      : undefined;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        id={id}
        type="button"
        disabled={disabled}
        aria-required={required}
        {...aria}
        className={cn("flex h-10 w-full items-center justify-between gap-2 rounded-[var(--radius)]! border-2 border-border bg-background px-4 py-2 text-left font-sans text-base font-normal text-foreground shadow-md focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive", className)}
      >
        <span className={cn(!value && "text-muted-foreground")}>{selected ? `${format(selected, "MM/dd/yyyy")}${includeTime && value.includes("T") ? ` ${value.split("T")[1]}` : ""}` : "Select date"}</span>
        <CalendarDays className="size-4 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-[1100]">
          <Popover.Popup className="rounded! border-2 border-border bg-background shadow-md">
            <Calendar mode="single" selected={selected} defaultMonth={selected || minimum}
              disabled={(date) => Boolean((minimum && date < minimum) || (maximum && date > maximum))}
              onSelect={(date) => {
                if (!date) {
                  onValueChange("");
                  if (!includeTime) setOpen(false);
                  return;
                }
                const nextDatePart = format(date, "yyyy-MM-dd");
                const existingTime = value.split("T")[1];
                const defaultTime =
                  minDatePart &&
                  minTimePart &&
                  nextDatePart === minDatePart &&
                  (!existingTime || existingTime < minTimePart)
                    ? minTimePart
                    : existingTime || "00:00";
                onValueChange(nextDatePart + (includeTime ? `T${defaultTime}` : ""));
                if (!includeTime) setOpen(false);
              }}
            />
            {includeTime && <div className="space-y-2 px-3 pb-3"><label className="block text-sm font-medium">Time<Input type="time" aria-label="Time" min={timeMin} value={value.split("T")[1] || ""} disabled={!value} onChange={(event) => { if (value && event.target.value) onValueChange(value.split("T")[0] + "T" + event.target.value); }} /></label><Button type="button" size="sm" onClick={() => setOpen(false)}>Done</Button></div>}
            {!required && value && <div className="px-3 pb-3"><Button type="button" variant="outline" size="sm" onClick={() => { onValueChange(""); setOpen(false); }}>Clear date</Button></div>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
