import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Alert } from "@/components/retroui/Alert";
import { Dialog } from "@/components/retroui/Dialog";
import {
  getMyReviewer,
  listMyReviewers,
  type StudentReviewerDetail,
  type StudentReviewerSummary,
} from "@/lib/student-intervention-reviewers-api";

export default function StudentReviewerSection() {
  const [params, setParams] = useSearchParams();

  const raw = params.get("reviewer");
  const selectedId = raw && /^\d+$/.test(raw) ? Number(raw) : null;

  const [items, setItems] = useState<StudentReviewerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudentReviewerDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listMyReviewers();
      setItems(result.items);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load reviewers."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
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

    getMyReviewer(selectedId)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setDetailError(
            cause instanceof Error ? cause.message : "Unable to load reviewer."
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("reviewer");
    setParams(next);
  };

  const open = (id: number) => {
    const next = new URLSearchParams(params);
    next.set("reviewer", String(id));
    setParams(next);
  };

  return (
    <section className="w-full space-y-4" aria-label="Reviewers from your teacher">
      <h2 className="text-xl font-bold">Reviewers from your teacher</h2>

      {error && (
        <Alert status="error">
          {error}{" "}
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => void load()}
          >
            Retry
          </Button>
        </Alert>
      )}

      {loading ? (
        <p>Loading your reviewers...</p>
      ) : !error && items.length === 0 ? (
        <Card className="w-full p-5 md:p-6">
          <p className="font-semibold">
            No teacher reviewers have been shared with you yet.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Reviewers sent by your teacher will appear here.
          </p>
        </Card>
      ) : (
        !error && (
          <div className="grid w-full gap-4">
            {items.map((item) => (
              <Card key={item.material_id} className="w-full space-y-4 p-5 md:p-6">
                <h3 className="font-bold">{item.title}</h3>
                <p>{item.subject_name}</p>
                <p className="text-xs text-muted-foreground">
                  Shared {new Date(item.sent_at).toLocaleDateString("en-PH")}
                </p>
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => open(item.material_id)}
                >
                  Read Reviewer
                </Button>
              </Card>
            ))}
          </div>
        )
      )}

      <Dialog
        open={selectedId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            close();
          }
        }}
      >
        <Dialog.Content size="lg" className="max-h-[85vh] flex flex-col p-0 overflow-hidden">
          <Dialog.Header>
            <div>
              <Dialog.Title className="text-xl font-bold">
                {detail?.title || "Teacher reviewer"}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                {detail?.subject_name || "Study support from your teacher"}
              </Dialog.Description>
            </div>
          </Dialog.Header>

          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
            {detailError ? (
              <Alert status="error">{detailError}</Alert>
            ) : detail ? (
              <div className="space-y-4">
                <p className="font-medium text-sm text-foreground">
                  {detail.introduction}
                </p>
                <div className="whitespace-pre-wrap leading-relaxed rounded border-2 border-border bg-muted/40 p-4 font-mono text-xs md:text-sm">
                  {detail.body}
                </div>
              </div>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Loading reviewer...</p>
            )}
          </div>

          <Dialog.Footer className="flex justify-end p-4 border-t border-border">
            <Button variant="outline" size="sm" onClick={close}>
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </section>
  );
}
