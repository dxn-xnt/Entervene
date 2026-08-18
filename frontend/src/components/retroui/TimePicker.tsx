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

    const activePeriod = lockedPeriod || value.period;
    const { hour, minute } = value;
    const pad = (num: number) => String(num).padStart(2, "0");

    const formattedValue = `${hour}:${pad(minute)} ${activePeriod.toLowerCase()}`;
    const [inputText, setInputText] = React.useState(formattedValue);

    // Sync input text when value or activePeriod changes externally
    React.useEffect(() => {
        setInputText(`${value.hour}:${pad(value.minute)} ${(lockedPeriod || value.period).toLowerCase()}`);
    }, [value.hour, value.minute, value.period, lockedPeriod]);

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

    const hoursOptions = Array.from({ length: 12 }, (_, i) => i + 1);
    // 5-minute interval options for popover picker
    const minutesOptions = Array.from({ length: 12 }, (_, i) => i * 5);

    // School hours: AM 6-11, PM 12 + 1-5 (Longest end time 5:00 PM)
    const isHourValid = (h: number, p: string) => {
        if (p === 'AM') {
            return h >= 6 && h <= 11;
        } else {
            return h === 12 || (h >= 1 && h <= 5);
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
        if (!isHourValid(hour, p)) {
            newHour = p === 'AM' ? 6 : 12;
        }
        onChange({ hour: newHour, minute, period: p });
    };

    // Parse custom text typed directly into the input box
    const parseCustomInput = (raw: string) => {
        const clean = raw.trim();
        if (!clean) return;

        // Match formats: "09:12", "9 12", "9:12 am", "10:24 pm", "1024"
        const match = clean.match(/^(\d{1,2})[:\s]*(\d{2})?\s*(am|pm)?$/i);
        if (match) {
            let h = parseInt(match[1], 10);
            const m = match[2] ? parseInt(match[2], 10) : 0;
            let p = match[3] ? match[3].toUpperCase() : activePeriod;

            if (h > 12) {
                h = h - 12;
                p = "PM";
            } else if (h === 0) {
                h = 12;
                p = "AM";
            }

            if (h >= 1 && h <= 12 && m >= 0 && m <= 59) {
                const finalPeriod = lockedPeriod || p;
                onChange({ hour: h, minute: m, period: finalPeriod });
                setInputText(`${h}:${pad(m)} ${finalPeriod.toLowerCase()}`);
            }
        }
    };

    return (
        <div className={`relative inline-flex items-center text-left ${isOpen ? "z-50" : "z-0"}`} ref={popoverRef}>
            <div className="flex items-center border-2 border-black bg-white rounded-none overflow-hidden shadow-sm">
                {/* Direct Editable Input */}
                <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onBlur={(e) => parseCustomInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            parseCustomInput(inputText);
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                    placeholder="08:00 am"
                    className="w-20 px-2 py-1 text-xs font-bold font-mono text-center focus:outline-none focus:bg-amber-50"
                    title="Type any custom time (e.g. 09:12 am, 10:24 am)"
                />

                {/* Clock Icon Button for 5-minute interval popover */}
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    title="Open 5-minute interval picker"
                    className="p-1.5 border-l-2 border-black hover:bg-amber-200 transition-colors cursor-pointer flex items-center justify-center"
                >
                    <Clock className="size-3.5 text-black" />
                </button>
            </div>

            {isOpen && (
                <div className="absolute z-50 left-0 top-full mt-1.5 bg-white border-2 border-black shadow-md p-3 flex flex-col gap-2 min-w-[280px]">
                    <div className="p-1 border-2 border-black rounded flex items-center justify-center font-bold text-xl">
                        <span>{hour} : {pad(minute)} {activePeriod.toLowerCase()}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 h-44">
                        {/* Hours list */}
                        <div className="flex flex-col overflow-y-auto border-1 border-border rounded bg-white">
                            <span className="text-[10px] font-bold text-center text-background border-b border-black/10 py-0.5 bg-foreground">Hour</span>
                            {hoursOptions.map((h) => {
                                const valid = isHourValid(h, activePeriod);
                                return (
                                    <button
                                        key={h}
                                        type="button"
                                        disabled={!valid}
                                        onClick={() => handleHourSelect(h)}
                                        className={`py-1 text-xs font-bold font-mono ${h === hour
                                            ? "bg-primary"
                                            : valid
                                                ? "hover:bg-accent"
                                                : "opacity-30 cursor-not-allowed"
                                            }`}
                                    >
                                        {h}
                                    </button>
                                );
                            })}
                        </div>

                        {/* 5-minute interval list */}
                        <div className="flex flex-col overflow-y-auto border-1 border-border rounded bg-white">
                            <span className="text-[10px] font-bold text-center text-background border-b border-black/10 py-0.5 bg-foreground">Minutes</span>
                            {minutesOptions.map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => handleMinuteSelect(m)}
                                    className={`py-1 text-xs font-bold font-mono ${m === minute ? "bg-primary" : "hover:bg-accent"
                                        }`}
                                >
                                    {pad(m)}
                                </button>
                            ))}
                        </div>

                        {/* AM/PM toggle */}
                        <div className="flex flex-col overflow-y-auto border-1 border-border rounded bg-white">
                            <span className="text-[10px] font-bold text-center text-background border-b border-black/10 py-0.5 bg-foreground">Period</span>
                            {["AM", "PM"].map((p) => {
                                const disabled = !!lockedPeriod && p !== lockedPeriod;
                                return (
                                    <button
                                        key={p}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => handlePeriodSelect(p)}
                                        className={`py-1 text-xs font-bold font-mono ${p === activePeriod
                                            ? "bg-primary"
                                            : disabled
                                                ? "opacity-30 cursor-not-allowed"
                                                : "hover:bg-accent"
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
