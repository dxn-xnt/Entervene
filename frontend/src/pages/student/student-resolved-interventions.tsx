import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { getMyResolvedIntervention, listMyResolvedInterventions, type StudentPersistentIntervention } from "@/lib/student-persistent-interventions-api";

const date = (value: string) => new Date(value).toLocaleDateString("en-PH", { dateStyle: "medium" });

export default function StudentResolvedInterventions() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("previous");
  const selectedId = selected && /^\d+$/.test(selected) ? Number(selected) : null;
  const [items, setItems] = useState<StudentPersistentIntervention[]>([]);
  const [detail, setDetail] = useState<StudentPersistentIntervention | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyResolvedInterventions().then((result) => { if (!cancelled) setItems(result.items); })
      .catch(() => { if (!cancelled) setError("Unable to load previous support."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selectedId === null) { setDetail(null); setDetailError(null); return; }
    let cancelled = false;
    setDetail(null); setDetailError(null);
    getMyResolvedIntervention(selectedId).then((result) => { if (!cancelled) setDetail(result); })
      .catch(() => { if (!cancelled) setDetailError("Previous support is unavailable."); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const open = (id: number) => { const next = new URLSearchParams(params); next.set("previous", String(id)); setParams(next); };
  const openReviewer = (id: number) => { const next = new URLSearchParams(params); next.set("reviewer", String(id)); setParams(next); };

  return <section className="space-y-3" aria-label="Previous Support">
    <h2 className="text-xl font-bold">Previous Support</h2>
    {loading ? <p>Loading previous support...</p> : error ? <Alert status="error">{error}</Alert>
      : items.length === 0 ? <p>No previous support yet.</p>
      : <div className="grid gap-3 md:grid-cols-2">{items.map((item) => <Card key={item.intervention_id} className="space-y-2 border-green-700 bg-green-50 p-4">
        <h3 className="font-bold">{item.subject_name} · Resolved</h3>
        <p className="text-sm">{item.resolved_at ? date(item.resolved_at) : "Previous support"} · {item.resolution_message}</p>
        <Button size="sm" variant="outline" onClick={() => open(item.intervention_id)}>View Previous Support</Button>
      </Card>)}</div>}
    {selectedId !== null && <Card className="space-y-3 border-green-700 bg-green-50 p-4" role="region" aria-label="Previous support detail">
      {detailError ? <Alert status="error">{detailError}</Alert> : !detail ? <p>Loading previous support...</p> : <>
        <h3 className="text-lg font-bold">{detail.subject_name} · Resolved</h3>
        <p>{detail.resolution_message}</p>
        <p>Resolved: {detail.resolved_at ? date(detail.resolved_at) : "Unavailable"}</p>
        <h4 className="font-bold">Completed support</h4>
        {detail.activities.filter((activity) => activity.submission_status === "graded").length ? detail.activities.filter((activity) => activity.submission_status === "graded").map((activity) => <p key={activity.assignment_id}>{activity.title} · Completed{activity.grade != null && activity.total_points != null ? ` · Score: ${activity.grade}/${activity.total_points}` : ""}</p>) : <p>No completed activity was recorded.</p>}
        {detail.reviewer_id !== null && <Button size="sm" variant="outline" onClick={() => openReviewer(detail.reviewer_id!)}>Read Reviewer</Button>}
      </>}
    </Card>}
  </section>;
}
