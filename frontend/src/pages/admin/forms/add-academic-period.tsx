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

interface DatePickerProps {
    id?: string;
    selected: Date | undefined;
    onSelect: (date: Date | undefined) => void;
    placeholder?: string;
}

function DatePicker({ id, selected, onSelect, placeholder = "Select date" }: DatePickerProps) {
    const [isOpen, setIsOpen] = React.useState(false);

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
                            initialFocus
                        />
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}

interface PeriodCardProps {
    index: number;
}

function PeriodCard({ index }: PeriodCardProps) {
    const [startDate, setStartDate] = React.useState<Date | undefined>(undefined);
    const [endDate, setEndDate] = React.useState<Date | undefined>(undefined);

    return (
        <div className="p-1">
            <Card className="w-full block">
                <Card.Content className="flex flex-col gap-4 p-2">
                    <div className="flex items-center justify-between border-b pb-2 border-border/40">
                        <Text className="font-bold text-md">Period {index + 1}</Text>
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-mono">
                            {index + 1} of 4
                        </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-muted-foreground" htmlFor={`start-date-${index}`}>Start Date</label>
                            <DatePicker
                                id={`start-date-${index}`}
                                selected={startDate}
                                onSelect={setStartDate}
                                placeholder="Select start date"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-muted-foreground" htmlFor={`end-date-${index}`}>End Date</label>
                            <DatePicker
                                id={`end-date-${index}`}
                                selected={endDate}
                                onSelect={setEndDate}
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
    return (
        <Dialog.Content size={"lg"}>
            <Dialog.Header position={"fixed"} asChild>
                <Text as="h5" className="font-sans text-xl font-bold">Add Academic Period</Text>
            </Dialog.Header>
            <section className="flex flex-col gap-4 p-4">
                <section className="text-md">
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <label htmlFor="end-date" className="text-sm">Academic Year</label>
                            <Select defaultValue={"2026-2027"}>
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
                        <div className="flex flex-col gap-1">
                            <label htmlFor="end-date" className="text-sm">Period Type</label>
                            <Select defaultValue={"quarterly"}>
                                <Select.Trigger className="w-full">
                                    <Select.Value placeholder="Period Type" />
                                </Select.Trigger>
                                <Select.Content>
                                    <Select.Group>
                                        <Select.Item value="quarterly">Quarterly</Select.Item>
                                        <Select.Item value="trimestral">Trimestral</Select.Item>
                                        <Select.Item value="semestral">Semestral</Select.Item>
                                    </Select.Group>
                                </Select.Content>
                            </Select>
                        </div>
                        <Carousel className="w-full max-w-sm md:max-w-lg mx-auto relative">
                            <Carousel.Content>
                                {Array.from({ length: 4 }).map((_, index) => (
                                    <Carousel.Item key={index}>
                                        <PeriodCard index={index} />
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