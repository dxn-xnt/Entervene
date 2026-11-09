"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/retroui/Button";
import { useToast } from "@/components/retroui/Toast";
import { Text } from "@/components/retroui/Text";
import { FormMessage } from "@/components/retroui/FormMessage";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Carousel } from "@/components/retroui/Carousel";
import { Calendar } from "@/components/retroui/Calendar";
import { formatPeriodLabel, periodTotal } from "@/lib/academic-periods";
import { ApiRequestError } from "@/lib/api";
import {
    createAcademicPeriods,
    getAcademicYearsSettings,
    type AcademicYearSettingItem,
} from "@/lib/settings-api";


interface DatePickerProps {
    id?: string;
    invalid?: boolean;
    errorId?: string;
    selected: Date | undefined;
    onSelect: (date: Date | undefined) => void;
    placeholder?: string;
    minDate?: Date;
    maxDate?: Date;
}

function DatePicker({ id, invalid, errorId, selected, onSelect, placeholder = "Select date", minDate, maxDate }: DatePickerProps) {
    const [isOpen, setIsOpen] = React.useState(false);

    // Helpers to compare dates ignoring time
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
                aria-invalid={invalid}
                aria-describedby={invalid ? errorId : undefined}
                className={`flex h-10 w-full rounded items-center justify-between border-2 border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 text-left cursor-pointer ${invalid ? "border-destructive" : "border-border"}`}
            >
                <span className={selected ? "text-foreground" : "text-muted-foreground"}>
                    {selected ? format(selected, "PPP") : placeholder}
                </span>
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
                    <Popover.Popup className="border-2 border-border bg-background text-popover-foreground rounded overflow-hidden">
                        <Calendar
                            mode="single"
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

interface PeriodCardProps {
    index: number;
    total: number;
    startDate: Date | undefined;
    endDate: Date | undefined;
    onStartDateChange: (date: Date | undefined) => void;
    onEndDateChange: (date: Date | undefined) => void;
    minStartDate?: Date;
    maxStartDate?: Date;
    minEndDate?: Date;
    maxEndDate?: Date;
    periodType: string;
    error?: string | null;
}

function PeriodCard({
    index,
    total,
    startDate,
    endDate,
    onStartDateChange,
    onEndDateChange,
    minStartDate,
    maxStartDate,
    minEndDate,
    maxEndDate,
    periodType,
    error,
}: PeriodCardProps) {
    const invalidStart = !!error && !startDate;
    const invalidEnd = !!error && (!endDate || (!!startDate && !!endDate && startDate > endDate));
    const errorId = `period-date-error-${index}`;
    return (
        <div className="flex flex-col gap-5 py-3">
            <div className="flex items-center justify-between border-b pb-3 border-border/40">
                <Text className="font-bold text-md">
                    {formatPeriodLabel({ period_type: periodType, period_sequence: index + 1 })}
                </Text>
                <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-mono">
                    {index + 1} of {total}
                </span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor={`start-date-${index}`}>Start Date</label>
                    <DatePicker
                        id={`start-date-${index}`}
                        invalid={invalidStart}
                        errorId={errorId}
                        selected={startDate}
                        onSelect={onStartDateChange}
                        minDate={minStartDate}
                        maxDate={maxStartDate}
                        placeholder="Select start date"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor={`end-date-${index}`}>End Date</label>
                    <DatePicker
                        id={`end-date-${index}`}
                        invalid={invalidEnd}
                        errorId={errorId}
                        selected={endDate}
                        onSelect={onEndDateChange}
                        minDate={minEndDate}
                        maxDate={maxEndDate}
                        placeholder="Select end date"
                    />
                </div>
            </div>
            {error && <FormMessage id={errorId}>{error}</FormMessage>}
        </div>
    );
}

interface AddAcademicPeriodModalProps {
    onClose?: () => void;
    onSaved?: () => void | Promise<void>;
}

export default function AddAcademicPeriodModal({ onClose, onSaved }: AddAcademicPeriodModalProps = {}) {
    const toast = useToast();
    const [academicYears, setAcademicYears] = React.useState<AcademicYearSettingItem[]>([]);
    const [academicYear, setAcademicYear] = React.useState<string>("");
    const [periodType, setPeriodType] = React.useState<string>("TERM");
    const [isSaving, setIsSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [validationAttempt, setValidationAttempt] = React.useState(0);

    React.useEffect(() => {
        getAcademicYearsSettings()
            .then((years) => {
                setAcademicYears(years);
                const active = years.find((y) => y.is_active) || years[0];
                if (active) {
                    setAcademicYear(active.year_label);
                }
            })
            .catch((err) => {
                console.error("Failed to load academic years:", err);
            });
    }, []);

    const totalPeriods = React.useMemo(() => periodTotal(periodType), [periodType]);

    const [dates, setDates] = React.useState<{ startDate?: Date; endDate?: Date }[]>(() =>
        Array.from({ length: 3 }).map(() => ({}))
    );

    // Reset/reinitialize dates when academicYear or periodType changes
    React.useEffect(() => {
        setDates(Array.from({ length: totalPeriods }).map(() => ({})));
        setError(null);
    }, [academicYear, totalPeriods]);

    // Parse the academic year limits
    const { ayStart, ayEnd } = React.useMemo(() => {
        const selectedAyObj = academicYears.find((y) => y.year_label === academicYear);
        if (selectedAyObj?.start_date && selectedAyObj?.end_date) {
            return {
                ayStart: new Date(selectedAyObj.start_date),
                ayEnd: new Date(selectedAyObj.end_date),
            };
        }
        const [startYearStr, endYearStr] = academicYear.split("-");
        const startYear = parseInt(startYearStr, 10) || new Date().getFullYear();
        const endYear = parseInt(endYearStr, 10) || startYear + 1;
        return {
            ayStart: new Date(startYear, 0, 1),
            ayEnd: new Date(endYear, 11, 31),
        };
    }, [academicYear, academicYears]);

    const handleDateChange = (idx: number, field: "startDate" | "endDate", value: Date | undefined) => {
        const nextPeriod = { ...dates[idx], [field]: value };
        setDates(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], [field]: value };
            return next;
        });
        if (error?.endsWith(formatPeriodLabel({ period_type: periodType, period_sequence: idx + 1 }) + ".") && nextPeriod.startDate && nextPeriod.endDate && nextPeriod.startDate <= nextPeriod.endDate) setError(null);
    };

    // Start date calculations:
    const getMinStartDate = (idx: number) => {
        let min = ayStart;
        if (idx > 0) {
            const prev = dates[idx - 1];
            if (prev?.endDate) {
                const dayAfter = new Date(prev.endDate);
                dayAfter.setDate(dayAfter.getDate() + 1);
                if (dayAfter > min) min = dayAfter;
            } else if (prev?.startDate) {
                const dayAfter = new Date(prev.startDate);
                dayAfter.setDate(dayAfter.getDate() + 1);
                if (dayAfter > min) min = dayAfter;
            }
        }
        return min;
    };

    const getMaxStartDate = (idx: number) => {
        let max = ayEnd;
        const current = dates[idx];
        if (current?.endDate && current.endDate < max) {
            max = current.endDate;
        }
        for (let i = idx + 1; i < dates.length; i++) {
            if (dates[i]?.startDate) {
                const dayBefore = new Date(dates[i].startDate!);
                dayBefore.setDate(dayBefore.getDate() - 1);
                if (dayBefore < max) max = dayBefore;
                break;
            }
        }
        return max;
    };

    // End date calculations:
    const getMinEndDate = (idx: number) => {
        let min = ayStart;
        const current = dates[idx];
        if (current?.startDate && current.startDate > min) {
            min = current.startDate;
        }
        if (idx > 0) {
            const prev = dates[idx - 1];
            if (prev?.endDate) {
                const dayAfter = new Date(prev.endDate);
                dayAfter.setDate(dayAfter.getDate() + 1);
                if (dayAfter > min) min = dayAfter;
            }
        }
        return min;
    };

    const getMaxEndDate = (idx: number) => {
        let max = ayEnd;
        for (let i = idx + 1; i < dates.length; i++) {
            if (dates[i]?.startDate) {
                const dayBefore = new Date(dates[i].startDate!);
                dayBefore.setDate(dayBefore.getDate() - 1);
                if (dayBefore < max) max = dayBefore;
                break;
            }
        }
        return max;
    };

    const handleConfirm = async () => {
        const selectedAyObj = academicYears.find((y) => y.year_label === academicYear);
        if (!selectedAyObj) {
            setError("Please select a valid academic year.");
            setValidationAttempt((attempt) => attempt + 1);
            return;
        }

        // Validate all periods are filled
        for (let i = 0; i < totalPeriods; i++) {
            const p = dates[i];
            if (!p?.startDate || !p?.endDate) {
                setError(`Please select both start and end dates for ${formatPeriodLabel({ period_type: periodType, period_sequence: i + 1 })}.`);
                setValidationAttempt((attempt) => attempt + 1);
                return;
            }
            if (p.startDate > p.endDate) {
                setError(`Start date cannot be after end date for ${formatPeriodLabel({ period_type: periodType, period_sequence: i + 1 })}.`);
                setValidationAttempt((attempt) => attempt + 1);
                return;
            }
        }

        setIsSaving(true);
        setError(null);
        let created = false;
        try {
            const payload = {
                academic_year_id: selectedAyObj.academic_year_id,
                period_type: periodType,
                periods: dates.slice(0, totalPeriods).map((p, idx) => ({
                    period_sequence: idx + 1,
                    start_date: format(p.startDate!, "yyyy-MM-dd"),
                    end_date: format(p.endDate!, "yyyy-MM-dd"),
                })),
            };

            await createAcademicPeriods(payload);
            created = true;
            if (onSaved) {
                await onSaved();
            }
            if (onClose) {
                onClose();
            }
        } catch (err: unknown) {
            console.error("Failed to save academic periods:", err);
            const msg = err instanceof Error ? err.message : "Failed to create academic periods.";
            if (!created && err instanceof ApiRequestError && (err.status === 400 || err.status === 422)) {
                setError(msg);
                setValidationAttempt((attempt) => attempt + 1);
            } else if (!created) toast.error({ title: "Unable to create academic periods", description: msg });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog.Content size={"lg"}>
            <Dialog.Header position={"fixed"} asChild>
                <Text as="h5" className="font-sans text-xl font-bold">Add Academic Period</Text>
            </Dialog.Header>
            <section className="flex flex-col gap-4 p-4">
                <AdminValidationAlert
                    message={error && !error.startsWith("Please select") && !error.startsWith("Start date") ? error : null}
                    attempt={validationAttempt}
                    firstInvalidFieldId={error === "Please select a valid academic year." ? "academic-year" : undefined}
                />
                <section className="text-md">
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <label htmlFor="academic-year" className="text-sm font-semibold">Academic Year</label>
                            <Select value={academicYear} onValueChange={(value) => { setAcademicYear(value); setError(null); }}>
                                <Select.Trigger id="academic-year" aria-invalid={error === "Please select a valid academic year."} aria-describedby={error === "Please select a valid academic year." ? "academic-year-error" : undefined} className="w-full aria-[invalid=true]:border-destructive">
                                    <Select.Value placeholder="Select Academic Year" />
                                </Select.Trigger>
                                <Select.Content>
                                    <Select.Group>
                                        {academicYears.length === 0 ? (
                                            <Select.Item value="none" disabled>Loading academic years...</Select.Item>
                                        ) : (
                                            academicYears.map((ay) => (
                                                <Select.Item key={ay.academic_year_id} value={ay.year_label}>
                                                    {ay.year_label} {ay.is_active ? "(Active)" : ""}
                                                </Select.Item>
                                            ))
                                        )}
                                    </Select.Group>
                                </Select.Content>
                            </Select>
                            {error === "Please select a valid academic year." && <FormMessage id="academic-year-error">{error}</FormMessage>}
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="period-type" className="text-sm font-semibold">Period Type</label>
                            <Select value={periodType} onValueChange={setPeriodType}>
                                <Select.Trigger className="w-full">
                                    <Select.Value placeholder="Period Type" />
                                </Select.Trigger>
                                <Select.Content>
                                    <Select.Group>
                                        <Select.Item value="TERM">Term</Select.Item>
                                        <Select.Item value="QUARTER">Quarter</Select.Item>
                                        <Select.Item value="SEMESTER">Semester</Select.Item>
                                    </Select.Group>
                                </Select.Content>
                            </Select>
                        </div>
                        <Carousel className="relative mt-4 w-full">
                            <div className="mx-14 min-w-0 sm:mx-16">
                                <Carousel.Content>
                                    {dates.map((period, index) => (
                                        <Carousel.Item key={index}>
                                            <PeriodCard
                                                index={index}
                                                total={totalPeriods}
                                                startDate={period.startDate}
                                                endDate={period.endDate}
                                                onStartDateChange={(date) => handleDateChange(index, "startDate", date)}
                                                onEndDateChange={(date) => handleDateChange(index, "endDate", date)}
                                                minStartDate={getMinStartDate(index)}
                                                maxStartDate={getMaxStartDate(index)}
                                                minEndDate={getMinEndDate(index)}
                                                maxEndDate={getMaxEndDate(index)}
                                                periodType={periodType}
                                                error={error?.endsWith(formatPeriodLabel({ period_type: periodType, period_sequence: index + 1 }) + ".") ? error : null}
                                            />
                                        </Carousel.Item>
                                    ))}
                                </Carousel.Content>
                            </div>
                            <Carousel.Previous className="left-0 top-1/2 size-10" />
                            <Carousel.Next className="right-0 top-1/2 size-10" />
                        </Carousel>

                    </div>
                </section>
            </section>
            <Dialog.Footer className="justify-end">
                <Button variant={"outline"} onClick={onClose} disabled={isSaving}>
                    Close
                </Button>
                <Button onClick={handleConfirm} disabled={isSaving || !academicYear}>
                    Confirm
                </Button>
            </Dialog.Footer>
        </Dialog.Content>
    );
}
