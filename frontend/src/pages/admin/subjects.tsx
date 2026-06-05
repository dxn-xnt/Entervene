// import { OverviewCard } from "@/components/overview-cards";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Card, CardTitle, CardHeader, CardContent } from "@/components/ui/card";
import AppLayout from "@/layouts/app-layout";
import { ArrowUpRight, Plus } from "lucide-react";

const DESCRIPTION = "Teachers Assigned";

const grades = [
  {
    grade: "Grade 7",
    subjects: [
      { title: "Math", count: "24" },
      { title: "English", count: "24" },
      { title: "Science", count: "24" },
      { title: "Filipino", count: "24" },
    ],
  },
  {
    grade: "Grade 8",
    subjects: [
      { title: "Math", count: "24" },
      { title: "English", count: "24" },
      { title: "Science", count: "24" },
      { title: "Filipino", count: "24" },
    ],
  },
  {
    grade: "Grade 9",
    subjects: [
      { title: "Math", count: "24" },
      { title: "English", count: "24" },
      { title: "Science", count: "24" },
      { title: "Filipino", count: "24" },
    ],
  },
  {
    grade: "Grade 10",
    subjects: [
      { title: "Math", count: "24" },
      { title: "English", count: "24" },
      { title: "Science", count: "24" },
      { title: "Filipino", count: "24" },
    ],
  },
];

export default function AdminSubjects() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between">
              <h1 className="text-4xl font-bold tracking-tight">Subjects</h1>
              <button className="flex items-center gap-1.5 rounded-lg border border-black bg-[#79bd80] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]">
                <Plus className="size-4" />
                New Subject
              </button>
            </header>
            <div className="-mx-4 md:-mx-6 border-b border-black/40" />
          </div>
          <div className="flex flex-col gap-3 px-4 md:px-6">
            {grades.map((item) => (
              <RetroCard key={item.grade} className="w-full p-4">
                <div className="flex flex-row justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold">{item.grade}</h2>
                  <button className="grid place-items-center size-8 rounded-full border-2 border-black cursor-pointer">
                    <ArrowUpRight className="size-4" />
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  {item.subjects.map((subject, i) => (
                    <Card key={i} className="bg-accent! cursor-pointer">
                      <CardHeader>
                        <CardTitle>{subject.title}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-4xl font-bold">{subject.count}</p>
                        <p className="text-sm mt-2">
                          <span className="font-semibold">{DESCRIPTION}</span>
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </RetroCard>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
