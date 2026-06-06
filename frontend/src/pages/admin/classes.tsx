import { useState } from "react";
import { Archive, ArrowDownUp, BookOpen, CheckCircle2, Filter, Plus, Search, Users } from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import ClassCard from "@/components/admin/classes/ClassCard";
import SummaryCard from "@/components/admin/classes/SummaryCard";
import AddClassModal from "@/components/admin/classes/modals/AddClassModal";
import ArchiveClassModal from "@/components/admin/classes/modals/ArchiveClassModal";
import { classData, GRADE_FILTERS, YEAR_OPTIONS } from "@/mocks/adminClasses";
import type { ClassRecord, ClassStatus, GradeFilter, StatusFilter, YearFilter } from "@/types/adminClasses";

export default function AdminClasses() {
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>("All");
  const [yearFilter, setYearFilter] = useState<YearFilter>("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [showNewClass, setShowNewClass] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ClassRecord | null>(null);
  const [archivedIds, setArchivedIds] = useState<string[]>([]);

  const classes = classData.map((item) => ({
    ...item,
    status: archivedIds.includes(item.id) ? ("Archived" as ClassStatus) : item.status,
  }));
  const filteredClasses = classes.filter((item) => {
    const text = `${item.grade} ${item.section} ${item.adviser}`.toLowerCase();
    return text.includes(search.toLowerCase())
      && (gradeFilter === "All" || item.grade === gradeFilter)
      && (yearFilter === "All" || item.academicYear === yearFilter)
      && (statusFilter === "All" || item.status === statusFilter);
  });
  const grouped = GRADE_FILTERS.slice(1)
    .map((grade) => ({ grade, classes: filteredClasses.filter((item) => item.grade === grade) }))
    .filter((group) => group.classes.length > 0);
  const summary = {
    total: classes.length,
    active: classes.filter((item) => item.status === "Active").length,
    archived: classes.filter((item) => item.status === "Archived").length,
    students: classes.filter((item) => item.status === "Active").reduce((total, item) => total + item.students.length, 0),
  };

  return (
    <AppLayout>
      <main className="flex flex-1 flex-col gap-5 px-4 py-4 md:px-6 md:py-5">
        <header className="flex flex-col gap-3 border-b border-black/40 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Class Management</h1>
            <p className="text-sm text-black/70">Manage class sections, advisers, students, subject load, and schedules.</p>
          </div>
          <button className="flex items-center gap-1.5 rounded-lg border-2 border-black bg-[#79bd80] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]" onClick={() => setShowNewClass(true)}>
            <Plus className="size-4" />New Class
          </button>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Total Classes" value={summary.total} icon={<BookOpen className="size-5" />} />
          <SummaryCard label="Active Classes" value={summary.active} icon={<CheckCircle2 className="size-5" />} />
          <SummaryCard label="Archived Classes" value={summary.archived} icon={<Archive className="size-5" />} />
          <SummaryCard label="Students Assigned" value={summary.students} icon={<Users className="size-5" />} />
        </section>

        <section className="grid gap-3 rounded-lg border border-black bg-[#fffdf5] p-3 shadow-[3px_3px_0_#000] md:grid-cols-[1fr_160px_140px]">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search class or adviser..." className="h-10 w-full rounded-md border border-black bg-white pl-9 pr-3 text-sm outline-none" />
          </label>
          <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value as YearFilter)} className="h-10 rounded-md border border-black bg-[#fffdf5] px-3 text-sm outline-none">
            {YEAR_OPTIONS.map((year) => <option key={year}>{year}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="h-10 rounded-md border border-black bg-[#fffdf5] px-3 text-sm outline-none">
            <option value="All">All Statuses</option><option value="Active">Active</option><option value="Archived">Archived</option>
          </select>
        </section>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="shrink-0 text-xs font-medium text-black/50">Grade:</span>
          {GRADE_FILTERS.map((grade) => (
            <button key={grade} onClick={() => setGradeFilter(grade)} className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${gradeFilter === grade ? "border-black bg-black text-white" : "border-black/30 bg-background text-black/60 hover:border-black/60 hover:text-black"}`}>{grade}</button>
          ))}
          <div className="ml-auto flex items-center gap-3 text-xs">
            <button className="flex items-center gap-1.5 font-medium"><Filter className="size-4" />Add Filter</button>
            <button className="flex items-center gap-1.5 font-medium"><ArrowDownUp className="size-4" />Sort By</button>
          </div>
        </div>

        <section className="grid gap-4">
          {grouped.length === 0 && <div className="rounded-lg border border-black bg-[#fffdf5] p-8 text-center text-sm text-black/60 shadow-[3px_3px_0_#000]">No classes match the selected filters.</div>}
          {grouped.map((group) => (
            <div key={group.grade} className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[4px_4px_0_#000]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xl font-bold">{group.grade}</h2>
                <span className="rounded-full border border-black bg-[#f7e9aa] px-3 py-1 text-xs font-bold">{group.classes.length} section{group.classes.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.classes.map((item) => <ClassCard key={item.id} item={item} onEdit={() => setShowNewClass(true)} onArchive={() => setArchiveTarget(item)} />)}
              </div>
            </div>
          ))}
        </section>
      </main>
      {showNewClass && <AddClassModal onClose={() => setShowNewClass(false)} />}
      {archiveTarget && <ArchiveClassModal classRecord={archiveTarget} onClose={() => setArchiveTarget(null)} onConfirm={() => {
        setArchivedIds((previous) => [...previous, archiveTarget.id]);
        setArchiveTarget(null);
      }} />}
    </AppLayout>
  );
}
