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
    /** When set (e.g. "PM"), the period toggle is locked to this value */
    lockedPeriod?: string;
}

export function TimePickerSingle({ value, onChange, lockedPeriod }: TimePickerSingleProps) {
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

    const activePeriod = lockedPeriod || value.period;
    const { hour, minute } = value;

    const hoursOptions = Array.from({ length: 12 }, (_, i) => i + 1);
    const minutesOptions = Array.from({ length: 12 }, (_, i) => i * 5);

    // Practical school hours: AM 6-11, PM 12 + 1-9
    const isHourValid = (h: number, p: string) => {
        if (p === 'AM') {
            return h >= 6 && h <= 11;
        } else {
            return h === 12 || (h >= 1 && h <= 9);
        }
    };

    const handleHourSelect = (h: number) => {
        if (!isHourValid(h, activePeriod)) return;
        onChange({ hour: h, minute, period: activePeriod });
    };

    const handleMinuteSelect = (m: number) => {
        onChange({ hour, minute: m, period: activePeriod });
    };

    const handlePeriodSelect = (p: string) => {
        if (lockedPeriod) return; // locked, ignore
        let newHour = hour;
        // Clamp hour to valid range when switching periods
        if (!isHourValid(hour, p)) {
            newHour = p === 'AM' ? 6 : 12;
        }
        onChange({ hour: newHour, minute, period: p });
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
                <span>{hour}:{pad(minute)} {activePeriod.toLowerCase()}</span>
            </button>

            {isOpen && (
                <div className="absolute z-50 left-1/2 -translate-x-1/2 mt-1.5 bg-white border-2 border-black shadow-lg p-3 flex flex-col gap-2 min-w-[280px]">
                    <div className="bg-neutral-50 p-2 border border-black/10 rounded flex items-center justify-center font-bold text-lg font-mono">
                        <Clock className="size-5 mr-2 text-neutral-600" />
                        <span>{hour} : {pad(minute)} {activePeriod.toLowerCase()}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 h-44">
                        <div className="flex flex-col overflow-y-auto border border-black/20 rounded bg-white">
                            {hoursOptions.map(h => {
                                const valid = isHourValid(h, activePeriod);
                                return (
                                    <button
                                        key={h}
                                        type="button"
                                        disabled={!valid}
                                        onClick={() => handleHourSelect(h)}
                                        className={`py-1 text-sm font-medium font-mono ${h === hour
                                            ? "bg-black text-white font-bold"
                                            : valid
                                            ? "hover:bg-neutral-100"
                                            : "opacity-30 cursor-not-allowed"
                                            }`}
                                    >
                                        {h}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex flex-col overflow-y-auto border border-black/20 rounded bg-white">
                            {minutesOptions.map(m => (
                                    <button
                                        key={m}
                                        type="button"
                                        onClick={() => handleMinuteSelect(m)}
                                        className={`py-1 text-sm font-medium font-mono ${m === minute
                                            ? "bg-black text-white font-bold"
                                            : "hover:bg-neutral-100"
                                            }`}
                                    >
                                        {pad(m)}
                                    </button>
                            ))}
                        </div>

                        <div className="flex flex-col overflow-y-auto border border-black/20 rounded bg-white">
                            {["AM", "PM"].map(p => {
                                const disabled = !!lockedPeriod && p !== lockedPeriod;
                                return (
                                    <button
                                        key={p}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => handlePeriodSelect(p)}
                                        className={`py-1 text-sm font-medium font-mono ${p === activePeriod
                                            ? "bg-black text-white font-bold"
                                            : disabled
                                            ? "opacity-30 cursor-not-allowed"
                                            : "hover:bg-neutral-100"
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
