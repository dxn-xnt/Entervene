"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Carousel } from "@/components/retroui/Carousel";
import { Card } from "@/components/retroui/Card";
import { Calendar } from "@/components/retroui/Calendar";
import { formatPeriodLabel, periodTotal } from "@/lib/academic-periods";


interface DatePickerProps {
    id?: string;
    selected: Date | undefined;
    onSelect: (date: Date | undefined) => void;
    placeholder?: string;
    minDate?: Date;
    maxDate?: Date;
}

function DatePicker({ id, selected, onSelect, placeholder = "Select date", minDate, maxDate }: DatePickerProps) {
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
                className="flex h-10 w-full rounded items-center shadow-md focus:shadow-xs justify-between border-2 border-input border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 text-left cursor-pointer"
            >
                <span className={selected ? "text-foreground" : "text-muted-foreground"}>
                    {selected ? format(selected, "PPP") : placeholder}
                </span>
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
                    <Popover.Popup className="border-2 border-border bg-background text-popover-foreground shadow-md rounded-lg overflow-hidden">
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
}: PeriodCardProps) {
    return (
        <div className="p-1">
            <Card className="w-full block">
                <Card.Content className="flex flex-col gap-4 p-2">
                    <div className="flex items-center justify-between border-b pb-2 border-border/40">
                        <Text className="font-bold text-md">
                            {formatPeriodLabel({ period_type: periodType, period_sequence: index + 1 })}
                        </Text>
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-mono">
                            {index + 1} of {total}
                        </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-muted-foreground" htmlFor={`start-date-${index}`}>Start Date</label>
                            <DatePicker
                                id={`start-date-${index}`}
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
                                selected={endDate}
                                onSelect={onEndDateChange}
                                minDate={minEndDate}
                                maxDate={maxEndDate}
                                placeholder="Select end date"
                            />
                        </div>
                    </div>
                </Card.Content>
            </Card>
        </div>
    );
}

export default function AddAcademicPeriodModal() {
    const [academicYear, setAcademicYear] = React.useState<string>("2026-2027");
    const [periodType, setPeriodType] = React.useState<string>("TERM");
    const [level, setLevel] = React.useState<string>("junior-high");

    const totalPeriods = React.useMemo(() => periodTotal(periodType), [periodType]);

    const [dates, setDates] = React.useState<{ startDate?: Date; endDate?: Date }[]>(() =>
        Array.from({ length: 3 }).map(() => ({}))
    );

    // Reset/reinitialize dates when academicYear or periodType changes
    React.useEffect(() => {
        setDates(Array.from({ length: totalPeriods }).map(() => ({})));
    }, [academicYear, totalPeriods]);

    // Parse the academic year limits
    const { ayStart, ayEnd } = React.useMemo(() => {
        const [startYearStr, endYearStr] = academicYear.split("-");
        const startYear = parseInt(startYearStr, 10) || 2026;
        const endYear = parseInt(endYearStr, 10) || 2027;
        return {
            ayStart: new Date(startYear, 0, 1), // January 1 of start year
            ayEnd: new Date(endYear, 11, 31),    // December 31 of end year
        };
    }, [academicYear]);

    const handleDateChange = (idx: number, field: "startDate" | "endDate", value: Date | undefined) => {
        setDates(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], [field]: value };
            return next;
        });
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

    return (
        <Dialog.Content size={"lg"}>
            <Dialog.Header position={"fixed"} asChild>
                <Text as="h5" className="font-sans text-xl font-bold">Add Academic Period</Text>
            </Dialog.Header>
            <section className="flex flex-col gap-4 p-4">
                <section className="text-md">
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <label htmlFor="academic-year" className="text-sm">Academic Year</label>
                            <Select value={academicYear} onValueChange={setAcademicYear}>
                                <Select.Trigger className="w-full">
                                    <Select.Value placeholder="Academic Year" />
                                </Select.Trigger>
                                <Select.Content>
                                    <Select.Group>
                                        <Select.Item value="2025-2026">2025-2026</Select.Item>
                                        <Select.Item value="2026-2027">2026-2027</Select.Item>
                                    </Select.Group>
                                </Select.Content>
                            </Select>
                        </div>
                        {/* <div className="flex flex-col gap-1">
                            <label htmlFor="year-level" className="text-sm">Year Level</label>
                            <Select value={level} onValueChange={setLevel}>
                                <Select.Trigger className="w-full">
                                    <Select.Value placeholder="Year Level" />
                                </Select.Trigger>
                                <Select.Content>
                                    <Select.Group>
                                        <Select.Item value="junior-high">Junior High</Select.Item>
                                        <Select.Item value="senior-high">Senior High</Select.Item>
                                    </Select.Group>
                                </Select.Content>
                            </Select>
                        </div> */}
                        <div className="flex flex-col gap-1">
                            <label htmlFor="end-date" className="text-sm">Period Type</label>
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
                        <Carousel className="w-full max-w-sm md:max-w-lg mx-auto relative">
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
                                        />
                                    </Carousel.Item>
                                ))}
                            </Carousel.Content>
                            <Carousel.Previous className="top-1/2" />
                            <Carousel.Next className="top-1/2" />
                        </Carousel>
                    </div>
                </section>
            </section>
            <Dialog.Footer>
                <Dialog.Trigger>
                    <Button>Confirm</Button>
                </Dialog.Trigger>
                <Dialog.Trigger>
                    <Button variant={"outline"}>Close</Button>
                </Dialog.Trigger>
            </Dialog.Footer>
        </Dialog.Content>
    );
}
