import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/student/button";
import { Card } from "@/components/retroui/Card";
import {
  getMyActiveIntervention,
  listMyActiveInterventions,
  type StudentPersistentIntervention,
} from "@/lib/student-persistent-interventions-api";

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

    listMyActiveInterventions()
      .then((result) => {
        if (!cancelled) {
          setItems(result.items);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Unable to load your active support."
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setDetailError(null);
      return;
    }

    let cancelled = false;
    setDetail(null);
    setDetailError(null);

    getMyActiveIntervention(selectedId)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setDetailError(cause instanceof Error ? cause.message : "Support unavailable.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const activityLink = (_item: StudentPersistentIntervention, assignmentId: number) =>
    `/student/classworks/${assignmentId}?from=${encodeURIComponent(
      window.location.pathname + window.location.search
    )}`;

  const renderInterventionCard = (item: StudentPersistentIntervention) => {
    const hasGradedActivity = item.activities.some(
      (activity) => activity.submission_status === "graded"
    );

    return (
      <Card key={item.intervention_id} className="w-full space-y-4 p-5 md:p-6">
        <div>
          <h3 className="text-lg font-bold">{item.subject_name} Support</h3>
          <p className="text-sm">
            {hasGradedActivity ? "Completed · Monitoring" : "Active Support"} · {item.class_name}
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          Your teacher has prepared additional support for this subject.
        </p>

        {hasGradedActivity && (
          <p className="rounded border border-green-700 bg-green-50 p-2 text-sm text-green-900">
            Your teacher is continuing to monitor your progress.
          </p>
        )}

        {item.activities.length ? (
          <div className="space-y-2">
            <h4 className="font-bold">Support Activities</h4>
            {item.activities.map((activity) => {
              const statusText =
                activity.submission_status === "graded"
                  ? "Completed"
                  : activity.submission_status === "submitted"
                    ? "Submitted"
                    : "Ready to work on";
              const scoreText =
                activity.grade !== null && activity.total_points !== null
                  ? ` · Score: ${activity.grade}/${activity.total_points}`
                  : "";

              return (
                <div key={activity.assignment_id} className="rounded border p-3 space-y-2">
                  <p className="font-semibold">{activity.title}</p>
                  <p className="text-sm">
                    {statusText}
                    {scoreText}
                  </p>
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={() =>
                      navigate(activityLink(item, activity.assignment_id))
                    }
                  >
                    View Activity
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No support activity has been published yet.
          </p>
        )}

        {item.reviewer_id !== null && (
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("reviewer", String(item.reviewer_id));
              setParams(next);
            }}
          >
            Read Reviewer
          </Button>
        )}
      </Card>
    );
  };

  return (
    <section className="flex flex-col gap-2 w-full" aria-label="Active Interventions">
      <h2 className="text-xl font-bold">Active Interventions</h2>

      {detailError && <Alert status="error">{detailError}</Alert>}

      {loading ? (
        <p>Loading your active support...</p>
      ) : error ? (
        <Alert status="error">{error}</Alert>
      ) : items.length === 0 && !selectedId ? (
        <p>No active interventions at this time.</p>
      ) : (
        <div className="grid w-full gap-4">
          {items.map((item) => {
            const currentItem =
              selectedId === item.intervention_id && detail ? detail : item;
            return renderInterventionCard(currentItem);
          })}
        </div>
      )}

      {selectedId !== null && !items.some((i) => i.intervention_id === selectedId) && (
        <div
          className="w-full space-y-4"
          role="region"
          aria-label="Intervention support detail"
        >
          {!detail && !detailError ? (
            <p>Loading support...</p>
          ) : detail ? (
            renderInterventionCard(detail)
          ) : null}
        </div>
      )}
    </section>
  );
}
