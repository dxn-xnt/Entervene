import type { SubjectLoadStudioData } from "@/lib/api";

/** Published rows stay locked until the server exposes an unlocked draft. */
export function getLockedSectionIds(data: SubjectLoadStudioData | null): Set<number> {
  return new Set(
    (data?.existing_loads || [])
      .filter((load) =>
        (load.status === "published" || load.status === "active") &&
        !data?.has_pending_draft_by_class?.[load.class_id]
      )
      .map((load) => load.class_id)
  );
}
