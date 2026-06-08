import { Archive, Eye, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import type { ClassListItem } from "@/types/adminClasses";

export default function ClassCard({ item, onEdit, onArchive }: {
  item: ClassListItem;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const isArchived = item.class_status.toLocaleLowerCase() === "archived";
  const adviserName = item.adviser ? [item.adviser.first_name, item.adviser.middle_name, item.adviser.last_name, item.adviser.suffix].filter(Boolean).join(" ") : "No adviser assigned";

  return (
    <article className="rounded-lg border-2 border-black bg-[#fff8d7] p-4 shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-bold leading-tight">{item.section_name}</h3>
          <p className="mt-0.5 text-[11px] font-semibold text-black/60">{item.academic_year.year_label}</p>
        </div>
        <span className={`shrink-0 rounded-full border border-black px-2 py-0.5 text-[10px] font-bold ${isArchived ? "bg-white text-black/60" : "bg-[#79bd80] text-[#1a4d1e]"}`}>
          {isArchived ? "Archived" : "Active"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <p className="text-3xl font-black leading-none">{item.student_count}</p>
          <p className="mt-1 text-[11px] font-semibold text-black/60">Students</p>
        </div>
        <div>
          <p className="text-3xl font-black leading-none">{item.subject_count}</p>
          <p className="mt-1 text-[11px] font-semibold text-black/60">Subjects</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-black/10 pt-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-[11px] font-semibold text-amber-900">
          {item.adviser ? adviserName.charAt(0) : "-"}
        </span>
        <span className="truncate text-xs font-semibold text-black/70">{adviserName}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {/* Primary action — filled green */}
        <Link
          to={`/admin/classes/${item.class_id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-black bg-[#79bd80] px-2.5 py-1 text-xs font-semibold text-[#1a4d1e] shadow-[2px_2px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[0px_0px_0_#000]"
        >
          <Eye className="size-3" /> View
        </Link>

        {!isArchived && (
          <>
            {/* Secondary action — white ghost */}
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-md border border-black bg-white px-2.5 py-1 text-xs font-semibold text-black shadow-[2px_2px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[0px_0px_0_#000]"
            >
              <Pencil className="size-3" /> Edit
            </button>

            {/* Destructive action — soft red */}
            <button
              onClick={onArchive}
              className="inline-flex items-center gap-1.5 rounded-md border border-black bg-[#fecdd3] px-2.5 py-1 text-xs font-semibold text-[#9f1239] shadow-[2px_2px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[0px_0px_0_#000]"
            >
              <Archive className="size-3" /> Archive
            </button>
          </>
        )}
      </div>
    </article>
  );
}
