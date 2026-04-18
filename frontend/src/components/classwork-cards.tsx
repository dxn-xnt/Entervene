import { Badge } from "@/components/retroui/Badge";

// #region agent log
fetch('http://127.0.0.1:7485/ingest/3a9a3448-1bd9-405f-8357-a95cb0abb46c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ccf95c'},body:JSON.stringify({sessionId:'ccf95c',runId:'pre-fix',hypothesisId:'H2',location:'classwork-cards.tsx:3',message:'classwork-cards module evaluated',data:{badgeImportPath:'@/components/retroui/Badge'},timestamp:Date.now()})}).catch(()=>{});
// #endregion

type CardProps = {
  title: string;
  subject?: string;
  date?: string;
  badge?: string;
};

const Cards = ({ title, subject, date, badge }: CardProps) => {
  // #region agent log
  fetch('http://127.0.0.1:7485/ingest/3a9a3448-1bd9-405f-8357-a95cb0abb46c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ccf95c'},body:JSON.stringify({sessionId:'ccf95c',runId:'pre-fix',hypothesisId:'H5',location:'classwork-cards.tsx:14',message:'Cards rendered',data:{title,hasSubject:Boolean(subject),hasDate:Boolean(date),hasBadge:Boolean(badge)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return (
    <div className="flex flex-row justify-between items-center px-4 py-3 border border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-row gap-3 items-center">
          <p className="font-semibold text-3xl">{title}</p>
        </div>
        <div className="flex flex-row gap-2 items-center text-sm">
          {/* Conditional separator */}
          <p>
            {subject && date ? `${subject} | ${date}` : subject || date || ""}
          </p>
        </div>
      </div>
      {badge && <Badge variant="surface">{badge}</Badge>}
    </div>
  );
};

export default Cards;
