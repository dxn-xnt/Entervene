import { Badge } from "@/components/retroui/Badge";
import { Card as RetroCard } from "@/components/retroui/Card";

type CardProps = {
    subject?: string;
    date?: string;
    badge?: string;
};

const SubjectItemLine = ({ subject, date, badge }: CardProps) => {
    return (
        <RetroCard className="flex flex-row justify-between items-center px-4 py-3">
            <div className="flex flex-col gap-1">
                <div className="flex flex-row gap-3 items-center">
                    <p className="font-semibold text-2xl">{subject}</p>
                </div>
                <div className="flex flex-row gap-2 items-center text-sm">
                    <p>
                        {date}
                    </p>
                </div>
            </div>
            {badge && <Badge variant="surface">{badge}</Badge>}
        </RetroCard>
    );
};

export default SubjectItemLine;
