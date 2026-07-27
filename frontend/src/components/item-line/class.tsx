import { Card as RetroCard } from "@/components/retroui/Card";

type CardProps = {
    subject?: string;
    date?: string;
    time?: string;
    schedule?: string[];
    onClick?: () => void;
};

const ClassItemLine = ({ subject, date, time, schedule, onClick }: CardProps) => {
    return (
        <RetroCard className="flex flex-row justify-between items-center px-4 py-3" onClick={onClick}>
            <div className="flex flex-col gap-1">
                <div className="flex flex-row gap-3 items-center">
                    <p className="font-semibold text-2xl">{subject}</p>
                </div>
                <div className="flex flex-row gap-2 items-center text-sm text-black/70">
                    <p>
                        {date}
                    </p>
                </div>
            </div>
            <div className="flex flex-col gap-1 items-end">
                {time ? (
                    <div className="flex flex-row gap-3 items-center">
                        <p className="font-normal text-base md:text-lg">{time}</p>
                    </div>
                ) : null}
                {schedule && schedule.length > 0 ? (
                    <div className="flex flex-row gap-2 items-center text-sm text-black/60">
                        <p className="font-normal text-xs">
                            ({schedule.join(", ")})
                        </p>
                    </div>
                ) : null}
            </div>

        </RetroCard>
    );
};

export default ClassItemLine;
