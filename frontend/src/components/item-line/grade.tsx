import { Badge } from "@/components/retroui/Badge";
import { Card as RetroCard } from "@/components/retroui/Card";

type CardProps = {
    section?: string;
    subject?: string;
    badge?: string;
    onClick?: () => void;
};

const GradeItemLine = ({ section, subject, badge, onClick }: CardProps) => {
    return (
        <RetroCard className="flex flex-row justify-between items-center px-4 py-2" onClick={onClick}>
            <div className="flex flex-col gap-1">
                <div className="flex flex-row gap-3 items-center">
                    <p className="font-semibold text-2xl">{section}</p>
                </div>
                <div className="flex flex-row gap-2 items-center text-sm">
                    <p>
                        {subject}
                    </p>
                </div>
            </div>
            {badge && <Badge variant="surface">{badge}</Badge>}
        </RetroCard>
    );
};

export default GradeItemLine;
