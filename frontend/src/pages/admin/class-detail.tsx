import { type ReactNode, useState } from "react";
import { BookOpen, ChevronRight, Pencil, Plus, Users } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import Tabs from "@/components/Tabs";
import AppLayout from "@/layouts/app-layout";
import { classData } from "@/mocks/adminClasses";
import type { ClassRecord, DetailTab, Student } from "@/types/adminClasses";

export default function AdminClassDetail() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>("classes");
  const selectedClass = classData.find((item) => item.id === classId) ?? classData[0];
  const groupedStudents = {
    Male: selectedClass.students.filter((student) => student.gender === "Male").sort((a, b) => a.name.localeCompare(b.name)),
    Female: selectedClass.students.filter((student) => student.gender === "Female").sort((a, b) => a.name.localeCompare(b.name)),
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
            <header className="flex items-center justify-between border-b border-black/40 pb-4">
              <h1 className="flex flex-wrap items-center gap-2 text-3xl font-bold tracking-tight">
                <button className="hover:underline" onClick={() => navigate("/admin/classes")}>Classes</button>
                <ChevronRight className="size-5" /><span className="text-2xl">{selectedClass.grade}</span>
                <ChevronRight className="size-5" /><span className="text-2xl">{selectedClass.section}</span>
              </h1>
              {tab === "students" ? (
                <ActionButton><Pencil className="size-4" />Edit Student List</ActionButton>
              ) : (
                <div className="flex gap-2">
                  <ActionButton><Pencil className="size-4" />Edit Class</ActionButton>
                  {tab === "subjects" && <ActionButton secondary><Plus className="size-4" />Add Subject Load</ActionButton>}
                </div>
              )}
            </header>
            <div className="-mx-4 border-b border-black/40 md:-mx-6">
              <Tabs
                tabs={[
                  { id: "classes", label: "Classes", icon: <BookOpen className="size-3.5" /> },
                  { id: "students", label: "Students", icon: <Users className="size-3.5" /> },
                  { id: "subjects", label: "Subject Load", icon: <BookOpen className="size-3.5" /> },
                ]}
                activeTab={tab}
                onChange={(id) => setTab(id as DetailTab)}
              />
            </div>
            <div className="flex flex-col gap-3 px-4 md:px-6">
              <section className="rounded-lg border border-black bg-[#f7e9aa] p-4 shadow-[3px_3px_0_#000]">
                <h2 className="text-2xl font-bold">{selectedClass.section}</h2>
                <p className="text-xs">{selectedClass.grade} - {selectedClass.academicYear} | Active since October 20, 2024</p>
              </section>
              {tab === "classes" && <OverviewTab selectedClass={selectedClass} />}
              {tab === "students" && <StudentsTab selectedClass={selectedClass} groupedStudents={groupedStudents} />}
              {tab === "subjects" && <SubjectLoadTab selectedClass={selectedClass} />}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function ActionButton({ children, secondary = false }: { children: ReactNode; secondary?: boolean }) {
  return <button className={`flex items-center gap-1.5 rounded-lg border-2 border-black ${secondary ? "bg-background" : "bg-[#79bd80]"} px-4 py-2 text-sm font-semibold shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]`}>{children}</button>;
}

function OverviewTab({ selectedClass }: { selectedClass: ClassRecord }) {
  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_300px]">
      <div className="grid gap-3">
        <h3 className="text-lg font-bold">Overview</h3>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]">
            <div className="mb-2"><h4 className="text-lg font-bold">Quarterly Class Performance</h4><p className="text-[10px] font-semibold text-black/65">Average class mastery across all subjects</p></div>
            <svg viewBox="0 0 620 170" className="h-40 w-full rounded-md bg-white" role="img" aria-label="Quarterly class performance graph">
              {[35, 65, 95, 125].map((y) => <line key={y} x1="38" x2="596" y1={y} y2={y} stroke="#dfd8bf" strokeWidth="1" />)}
              <line x1="38" x2="596" y1="140" y2="140" stroke="#222" strokeWidth="1" opacity=".35" />
              <polyline points="60,102 210,88 360,82 540,74" fill="none" stroke="#4f8b5f" strokeWidth="4" />
              <polyline points="60,114 210,108 360,102 540,96" fill="none" stroke="#e0be5a" strokeDasharray="5 4" strokeWidth="2" />
              {[["Q1", 58], ["Q2", 208], ["Q3", 358], ["Q4", 538]].map(([label, x]) => <text key={label} x={Number(x)} y="158" fontSize="10" fontWeight="700" fill="#555">{label}</text>)}
              <rect x="512" y="54" width="54" height="18" rx="8" fill="#4f8b5f" /><text x="526" y="67" fontSize="9" fontWeight="700" fill="white">88.4%</text>
            </svg>
          </section>
          <section className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]">
            <h4 className="text-lg font-bold">Subject Breakdown</h4><p className="mb-3 text-[10px] font-semibold text-black/65">Average mastery per subject load</p>
            <div className="grid gap-2">
              {selectedClass.subjects.map((subject, index) => (
                <div key={subject.name} className="grid grid-cols-[80px_1fr_34px] items-center gap-2 text-[10px]">
                  <span className="truncate font-semibold">{subject.name}</span>
                  <span className="h-2 rounded-full bg-black/15"><span className={`block h-full rounded-full ${index % 2 === 0 ? "bg-[#79bd80]" : "bg-[#f7c76f]"}`} style={{ width: `${subject.progress}%` }} /></span>
                  <span className="text-right font-bold">{subject.progress}%</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <section>
          <h3 className="mb-1 text-lg font-bold">Class Advisor</h3>
          <div className="flex items-center gap-3 rounded-lg border border-black bg-[#fffdf5] p-3 shadow-[3px_3px_0_#000]">
            <Avatar text={selectedClass.adviser} /><span><span className="block text-sm font-bold">{selectedClass.adviser}</span><span className="block text-[10px] font-semibold text-black/65">Advisory assigned since October 20, 2024</span></span>
          </div>
        </section>
        <section>
          <h3 className="mb-1 text-lg font-bold">Subjects</h3>
          <div className="grid gap-2">{selectedClass.subjects.map((subject) => (
            <div key={subject.name} className="flex min-h-16 items-center justify-between rounded-lg border border-black bg-[#fffdf5] px-4 py-3 shadow-[3px_3px_0_#000]">
              <span><span className="block text-xl font-black">{subject.name}</span><span className="block text-[10px] font-semibold text-black/65">Active since November 10, 2025</span></span><span className="text-xs font-semibold">{subject.time}</span>
            </div>
          ))}</div>
        </section>
      </div>
      <aside>
        <h3 className="mb-1 text-lg font-bold">Recent Activity</h3>
        <div className="grid gap-2 rounded-lg border border-black bg-[#fffdf5] p-3 shadow-[3px_3px_0_#000]">
          {[1, 2, 3, 4].map((item) => <div key={item} className="rounded-md border border-black/40 bg-background p-2 text-[10px]"><p className="font-semibold">New lessons added for Sci10</p><p className="text-black/65">Added by {selectedClass.adviser} - 2 hours ago</p></div>)}
        </div>
      </aside>
    </div>
  );
}

function StudentsTab({ selectedClass, groupedStudents }: { selectedClass: ClassRecord; groupedStudents: Record<"Male" | "Female", Student[]> }) {
  const atRisk = selectedClass.students.filter((student) => student.risk).length;
  const average = Math.round(selectedClass.students.reduce((sum, student) => sum + student.score, 0) / selectedClass.students.length);
  const sortedStudents = [...selectedClass.students].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Total Students" value={selectedClass.students.length} note="2% increased from last month"><GenderBar male={groupedStudents.Male.length} female={groupedStudents.Female.length} /></MetricCard>
        <MetricCard label="Avg. Class Score" value={`${average}%`} note="12% increased from last month" />
        <MetricCard label="At-Risk Students" value={atRisk} note="12% increased from last month" />
      </div>
      <section>
        <h3 className="mb-1 text-lg font-bold">Students</h3>
        <div className="overflow-hidden rounded-lg border border-black bg-[#fffdf5] shadow-[3px_3px_0_#000]">
          {sortedStudents.map((student) => (
            <button key={student.id} type="button" className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_120px_48px] items-center gap-3 border-b border-black/50 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-accent hover:text-sidebar-accent-foreground">
              <span className="flex min-w-0 items-center gap-3"><Avatar text={student.name} /><span className="truncate font-semibold">{student.name}</span></span>
              <span className="justify-self-center">{student.risk && <span className="rounded-full border border-[#d95d5d] bg-[#f07f7f] px-2 py-0.5 text-[10px] font-semibold">Marked at risk</span>}</span>
              <span className="justify-self-end font-black">{student.score}%</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, note, children }: { label: string; value: number | string; note?: string; children?: ReactNode }) {
  return <div className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]"><p className="text-sm font-bold">{label}</p><p className="mt-1 text-4xl font-black leading-none">{value}</p>{children}{note && <p className="mt-2 text-[10px] font-semibold text-black/70">{note}</p>}</div>;
}

function GenderBar({ male, female }: { male: number; female: number }) {
  const total = Math.max(male + female, 1);
  return <div className="mt-3 grid gap-1 text-[10px] font-semibold"><div className="flex h-3 overflow-hidden rounded-full border border-black bg-white"><div className="bg-[#79bd80]" style={{ width: `${(male / total) * 100}%` }} /><div className="bg-[#f7c76f]" style={{ width: `${(female / total) * 100}%` }} /></div><div className="flex justify-between"><span>Male {male}</span><span>Female {female}</span></div></div>;
}

function Avatar({ text }: { text: string }) {
  return <span className="grid size-7 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-[13px] font-semibold text-amber-900">{text.charAt(0)}</span>;
}

function SubjectLoadTab({ selectedClass }: { selectedClass: ClassRecord }) {
  if (!selectedClass.subjects.length) return <div className="rounded-lg border border-black bg-[#fffdf5] p-8 text-center shadow-[3px_3px_0_#000]">No subject load assigned yet.</div>;
  return (
    <section>
      <h3 className="mb-1 text-lg font-bold">Subject Load</h3>
      <div className="overflow-x-auto rounded-lg border border-black bg-[#fffdf5] shadow-[3px_3px_0_#000]">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(150px,1fr)_150px_130px_minmax(180px,1fr)] border-b border-black/50 px-3 py-1.5 text-[11px] font-semibold text-black/70"><span className="text-center">Subject</span><span className="text-center">Time</span><span className="text-center">Days</span><span className="text-center">Teacher</span></div>
          {selectedClass.subjects.map((subject, index) => (
            <div key={subject.name}>
              {index === 2 && <div className="border-b border-black/40 py-1 text-center text-[10px] font-semibold">Break</div>}
              {index === 4 && <div className="border-b border-black/40 py-1 text-center text-[10px] font-semibold">Lunch Break</div>}
              <div className="grid min-h-10 grid-cols-[minmax(150px,1fr)_150px_130px_minmax(180px,1fr)] items-center border-b border-black/40 px-3 py-2 text-xs last:border-b-0">
                <b>{subject.name}</b><span className="text-center">{subject.time}</span>
                <span className="flex justify-center gap-1">{["M", "T", "W", "Th", "F"].map((day) => <span key={day} className="grid size-5 place-items-center rounded-full border border-black/30 bg-white text-[9px]">{day}</span>)}</span>
                <span className="flex items-center justify-center gap-2"><Avatar text={subject.teacher} /><span className="font-semibold">{subject.teacher}</span></span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
