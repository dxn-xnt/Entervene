"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/retroui/Button";
import { useToast } from "@/components/retroui/Toast";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Calendar } from "@/components/retroui/Calendar";
import { Input } from "@/components/retroui/Input";
import { updateAcademicPeriod } from "@/lib/settings-api";

export interface DBPeriodItem {
  id: number;
  period: string;
  period_sequence: number;
  period_type: string;
  academic_year_id: number;
  academicyear: string;
  startDate: string | null;
  endDate: string | null;
  is_active: boolean;
  status: string;
}

interface DatePickerProps {
  id?: string;
  selected: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
}

function parseLocalDate(dateStr: string | null | undefined): Date | undefined {
  if (!dateStr) return undefined;
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? undefined : d;
  }
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function DatePicker({
  id,
  selected,
  onSelect,
  placeholder = "Select date",
  minDate,
  maxDate,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const isBefore = (d1: Date, d2: Date) => {
    const copy1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const copy2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return copy1.getTime() < copy2.getTime();
  };

  const isAfter = (d1: Date, d2: Date) => {
    const copy1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const copy2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return copy1.getTime() > copy2.getTime();
  };

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger
        id={id}
        className="flex h-10 w-full rounded! items-center justify-between border-2 border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 text-left cursor-pointer"
      >
        <span className={selected ? "text-foreground font-medium" : "text-muted-foreground"}>
          {selected ? format(selected, "PPP") : placeholder}
        </span>
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-[1050]">
          <Popover.Popup className="border-2 border-black bg-white text-popover-foreground rounded-lg shadow-[4px_4px_0_#000]">
            <Calendar
              mode="single"
              captionLayout="dropdown"
              selected={selected}
              onSelect={(date) => {
                onSelect(date);
                setIsOpen(false);
              }}
              disabled={(date) => {
                if (minDate && isBefore(date, minDate)) return true;
                if (maxDate && isAfter(date, maxDate)) return true;
                return false;
              }}
              initialFocus
              defaultMonth={selected || minDate}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface EditAcademicPeriodModalProps {
  period: DBPeriodItem;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditAcademicPeriodModal({
  period,
  onClose,
  onSaved,
}: EditAcademicPeriodModalProps) {
  const toast = useToast();

  const [periodName, setPeriodName] = React.useState(period.period);
  const [startDate, setStartDate] = React.useState<Date | undefined>(() =>
    parseLocalDate(period.startDate)
  );
  const [endDate, setEndDate] = React.useState<Date | undefined>(() =>
    parseLocalDate(period.endDate)
  );
  const [isSaving, setIsSaving] = React.useState(false);

  // Sync if period prop changes
  React.useEffect(() => {
    setPeriodName(period.period);
    setStartDate(parseLocalDate(period.startDate));
    setEndDate(parseLocalDate(period.endDate));
  }, [period]);

  const handleSave = async () => {
    const trimmedName = periodName.trim();
    if (!trimmedName) {
      toast.error({
        title: "Validation Error",
        description: "Period name cannot be empty.",
      });
      return;
    }

    if (!startDate || !endDate) {
      toast.error({
        title: "Validation Error",
        description: "Both start date and end date must be selected.",
      });
      return;
    }

    if (startDate > endDate) {
      toast.error({
        title: "Validation Error",
        description: "Start date cannot be after end date.",
      });
      return;
    }

    setIsSaving(true);
    try {
      await updateAcademicPeriod(period.id, {
        start_date: format(startDate, "yyyy-MM-dd"),
        end_date: format(endDate, "yyyy-MM-dd"),
        period_name: trimmedName,
      });

      toast.success({
        title: "Academic Period Updated",
        description: `Successfully updated ${trimmedName}.`,
      });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update academic period.";
      toast.error({
        title: "Update Failed",
        description: msg,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog.Content size="lg">
      <Dialog.Header position="fixed" asChild>
        <div className="flex items-center gap-2">
          <Text as="h5" className="font-sans text-xl font-bold">
            Edit Academic Period
          </Text>
        </div>
      </Dialog.Header>

      <section className="flex flex-col gap-4 p-4">
        {/* Academic Year & Status (Context info) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold">Academic Year</label>
            <div className="flex h-10 w-full items-center rounded border-2 border-border px-3 py-2 text-sm font-medium text-foreground">
              {period.academicyear}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold">Status</label>
            <div className="flex h-10 w-full items-center rounded border-2 border-border text-sm px-3 py-2">
              {period.is_active ? "Active" : period.status}
            </div>
          </div>
        </div>

        {/* Period Name */}
        <div className="flex flex-col gap-1">
          <label htmlFor="edit-period-name" className="text-sm font-semibold">
            Period Name
          </label>
          <Input
            id="edit-period-name"
            value={periodName}
            onChange={(e) => setPeriodName(e.target.value)}
            placeholder="e.g. Term 1"
            className="w-full"
          />
        </div>

        {/* Start Date & End Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="edit-start-date" className="text-sm font-semibold">
              Start Date
            </label>
            <DatePicker
              id="edit-start-date"
              selected={startDate}
              onSelect={setStartDate}
              placeholder="Select start date"
              maxDate={endDate}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="edit-end-date" className="text-sm font-semibold">
              End Date
            </label>
            <DatePicker
              id="edit-end-date"
              selected={endDate}
              onSelect={setEndDate}
              placeholder="Select end date"
              minDate={startDate}
            />
          </div>
        </div>
      </section>

      <Dialog.Footer className="justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={isSaving}>
          Close
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
