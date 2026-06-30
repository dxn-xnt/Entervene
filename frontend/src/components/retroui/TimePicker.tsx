import * as React from "react";
import { Clock } from "lucide-react";

export interface TimeValue {
    hour: number;
    minute: number;
    period: string;
}

export function parseTimeRange(timeStr: string) {
    const defaultStart = { hour: 8, minute: 0, period: "AM" };
    const defaultEnd = { hour: 9, minute: 0, period: "AM" };

    if (!timeStr) return { start: defaultStart, end: defaultEnd };

    const parts = timeStr.split("-").map(s => s.trim());
    if (parts.length !== 2) return { start: defaultStart, end: defaultEnd };

    const parseSingle = (str: string, defaultPeriod: string) => {
        const match = str.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (!match) return { hour: 8, minute: 0, period: defaultPeriod };

        const hour = parseInt(match[1], 10);
        const minute = parseInt(match[2], 10);
        const period = (match[3] || defaultPeriod).toUpperCase();

        return { hour, minute, period };
    };

    const endMatch = parts[1].match(/(AM|PM)/i);
    const endPeriod = endMatch ? endMatch[1].toUpperCase() : "AM";

    const startMatch = parts[0].match(/(AM|PM)/i);
    const startPeriod = startMatch ? startMatch[1].toUpperCase() : endPeriod;

    const start = parseSingle(parts[0], startPeriod);
    const end = parseSingle(parts[1], endPeriod);

    return { start, end };
}

export function formatTimeRange(start: TimeValue, end: TimeValue) {
    const pad = (num: number) => String(num).padStart(2, "0");
    const startStr = `${start.hour}:${pad(start.minute)} ${start.period}`;
    const endStr = `${end.hour}:${pad(end.minute)} ${end.period}`;
    return `${startStr} - ${endStr}`;
}

interface TimePickerSingleProps {
    value: TimeValue;
    onChange: (val: TimeValue) => void;
}

export function TimePickerSingle({ value, onChange }: TimePickerSingleProps) {
    const [isOpen, setIsOpen] = React.useState(false);
    const popoverRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    const { hour, minute, period } = value;

    const hoursOptions = Array.from({ length: 12 }, (_, i) => i + 1);
    const minutesOptions = Array.from({ length: 12 }, (_, i) => i * 5);

    const isHourValid = (h: number, p: string) => {
        if (p === 'AM') {
            return h >= 6 && h <= 11;
        } else {
            return h === 12 || (h >= 1 && h <= 6);
        }
    };

    const isPeriodValid = (h: number, p: string) => {
        if (p === 'AM') {
            return h >= 6 && h <= 11;
        } else {
            return h === 12 || (h >= 1 && h <= 6);
        }
    };

    const isMinuteValid = (h: number, m: number, p: string) => {
        if (p === 'PM' && h === 6) {
            return m === 0;
        }
        return true;
    };

    const handleHourSelect = (h: number) => {
        let newMinute = minute;
        if (period === 'PM' && h === 6) {
            newMinute = 0;
        }
        onChange({ hour: h, minute: newMinute, period });
    };

    const handleMinuteSelect = (m: number) => {
        onChange({ hour, minute: m, period });
    };

    const handlePeriodSelect = (p: string) => {
        let newHour = hour;
        let newMinute = minute;
        if (!isHourValid(hour, p)) {
            newHour = p === 'AM' ? 6 : 12;
        }
        if (p === 'PM' && newHour === 6) {
            newMinute = 0;
        }
        onChange({ hour: newHour, minute: newMinute, period: p });
    };

    const pad = (num: number) => String(num).padStart(2, "0");

    return (
        <div className={`relative inline-block text-left ${isOpen ? "z-50" : "z-0"}`} ref={popoverRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="px-2 py-1 border border-2 bg-white text-sm font-medium flex items-center gap-1.5 cursor-pointer min-w-[100px] justify-center animate-fade-in"
            >
                <Clock className="size-3.5 text-neutral-500" />
                <span>{hour}:{pad(minute)} {period.toLowerCase()}</span>
            </button>

            {isOpen && (
                <div className="absolute z-50 left-1/2 -translate-x-1/2 mt-1.5 bg-white border-2 border-black shadow-lg p-3 flex flex-col gap-2 min-w-[280px]">
                    <div className="bg-neutral-50 p-2 border border-black/10 rounded flex items-center justify-center font-bold text-lg font-mono">
                        <Clock className="size-5 mr-2 text-neutral-600" />
                        <span>{hour} : {pad(minute)} {period.toLowerCase()}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 h-44">
                        <div className="flex flex-col overflow-y-auto border border-black/20 rounded bg-white">
                            {hoursOptions.map(h => {
                                const valid = isHourValid(h, period);
                                return (
                                    <button
                                        key={h}
                                        type="button"
                                        disabled={!valid}
                                        onClick={() => handleHourSelect(h)}
                                        className={`py-1 text-sm font-medium font-mono ${h === hour
                                            ? "bg-black text-white font-bold"
                                            : "hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
                                            }`}
                                    >
                                        {h}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex flex-col overflow-y-auto border border-black/20 rounded bg-white">
                            {minutesOptions.map(m => {
                                const valid = isMinuteValid(hour, m, period);
                                return (
                                    <button
                                        key={m}
                                        type="button"
                                        disabled={!valid}
                                        onClick={() => handleMinuteSelect(m)}
                                        className={`py-1 text-sm font-medium font-mono ${m === minute
                                            ? "bg-black text-white font-bold"
                                            : "hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
                                            }`}
                                    >
                                        {pad(m)}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex flex-col overflow-y-auto border border-black/20 rounded bg-white">
                            {["AM", "PM"].map(p => {
                                const valid = isPeriodValid(hour, p);
                                return (
                                    <button
                                        key={p}
                                        type="button"
                                        disabled={!valid}
                                        onClick={() => handlePeriodSelect(p)}
                                        className={`py-1 text-sm font-medium font-mono ${p === period
                                            ? "bg-black text-white font-bold"
                                            : "hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
                                            }`}
                                    >
                                        {p.toLowerCase()}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
