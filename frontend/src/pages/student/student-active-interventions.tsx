import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { getMyActiveIntervention, listMyActiveInterventions, type StudentPersistentIntervention } from "@/lib/student-persistent-interventions-api";

export default function StudentActiveInterventions() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selected = params.get("intervention");
  const selectedId = selected && /^\d+$/.test(selected) ? Number(selected) : null;
  const [items, setItems] = useState<StudentPersistentIntervention[]>([]);
  const [detail, setDetail] = useState<StudentPersistentIntervention | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyActiveInterventions().then((result) => { if (!cancelled) setItems(result.items); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load your active support."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selectedId === null) { setDetail(null); setDetailError(null); return; }
    let cancelled = false;
    setDetail(null); setDetailError(null);
    getMyActiveIntervention(selectedId).then((result) => { if (!cancelled) setDetail(result); })
      .catch((cause) => { if (!cancelled) setDetailError(cause instanceof Error ? cause.message : "Support unavailable."); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const open = (id: number) => { const next = new URLSearchParams(params); next.set("intervention", String(id)); setParams(next); };
  const activityLink = (item: StudentPersistentIntervention, assignmentId: number) =>
    `/student/subjects/${item.class_id}/${item.subject_id}?tab=classwork&classworkAssignmentId=${assignmentId}`;

  return <section className="space-y-3" aria-label="Active Interventions">
    <h2 className="text-xl font-bold">Active Interventions</h2>
    {loading ? <p>Loading your active support...</p> : error ? <Alert status="error">{error}</Alert>
      : items.length === 0 ? <p>No active interventions at this time.</p>
      : <div className="grid gap-3 md:grid-cols-2">{items.map((item) => <Card key={item.intervention_id} className="space-y-3 p-4">
        <div><h3 className="text-lg font-bold">{item.subject_name} Support</h3><p className="text-sm">{item.activities.some((activity) => activity.submission_status === "graded") ? "Completed · Monitoring" : "Active Support"} · {item.class_name}</p></div>
        <p className="text-sm">Your teacher has prepared additional support for this subject.</p>
        <Button size="sm" onClick={() => open(item.intervention_id)}>View Support</Button>
      </Card>)}</div>}
    {selectedId !== null && <div className="rounded border-2 border-black bg-white p-4 space-y-3" role="region" aria-label="Intervention support detail">
      {detailError ? <Alert status="error">{detailError}</Alert> : !detail ? <p>Loading support...</p> : <>
        <h3 className="text-lg font-bold">{detail.subject_name} · Active Support</h3>
        <p>{detail.class_name}{detail.teacher_name ? ` · ${detail.teacher_name}` : ""}</p>
        {detail.activities.some((activity) => activity.submission_status === "graded") && <p className="rounded border border-green-700 bg-green-50 p-2 text-sm">Your teacher is continuing to monitor your progress.</p>}
        {detail.activities.length ? <div className="space-y-2"><h4 className="font-bold">Support Activities</h4>{detail.activities.map((activity) => <div key={activity.assignment_id} className="rounded border p-3 space-y-2">
          <p className="font-semibold">{activity.title}</p>
          <p className="text-sm">{activity.submission_status === "graded" ? "Completed" : activity.submission_status === "submitted" ? "Submitted" : "Ready to work on"}{activity.grade !== null && activity.total_points !== null ? ` · Score: ${activity.grade}/${activity.total_points}` : ""}</p>
          <Button size="sm" onClick={() => navigate(activityLink(detail, activity.assignment_id))}>View Activity</Button>
        </div>)}</div> : <p>No support activity has been published yet.</p>}
        {detail.reviewer_id !== null && <Button size="sm" variant="outline" onClick={() => { const next = new URLSearchParams(params); next.set("reviewer", String(detail.reviewer_id)); setParams(next); }}>Read Reviewer</Button>}
      </>}
    </div>}
  </section>;
}
