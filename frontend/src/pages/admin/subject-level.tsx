import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card as RetroCard } from "@/components/retroui/Card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Plus } from "lucide-react";
import { Text } from "@/components/retroui/Text";
import { OverviewCard } from "@/components/overview-cards";
import SubjectItemLine from "@/components/subject-item-line";
import { useNavigate, useParams } from "react-router-dom";


const overviewCards = [
  { title: "Students", count: "1402", stat: "12" },
  { title: "Teachers", count: "123", stat: "12" },
  { title: "Classes", count: "92", stat: "12" },
  { title: "Subjects", count: "67", stat: "12" },
];


const gradeSubjects = [
  { title: "Math", count: "Assigned since November 10, 2025" },
  { title: "English", count: "Assigned since November 10, 2025" },
  { title: "Science", count: "Assigned since November 10, 2025" },
  { title: "Filipino", count: "Assigned since November 10, 2025" },
];

export default function AdminSubjectLevel() {
  const navigate = useNavigate();
  const { grade } = useParams<{ grade: string }>();
  const decodedGrade = decodeURIComponent(grade || "Grade 7");

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 p-4">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <Breadcrumb>
                  <Breadcrumb.List>
                    <Breadcrumb.Item>
                      <Breadcrumb.Link href="/admin/subjects" className="text-2xl    ">Subjects</Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Page>{decodedGrade}</Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>

              <button className="flex items-center gap-1.5 rounded-lg border border-black bg-[#79bd80] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]">
                <Plus className="size-4" />
                New Subject
              </button>
            </header>
            <div className="-mx-4 md:-mx-6 border-b border-black/40" />

            <RetroCard className="p-3">
              <div className="flex flex-col gap-1">
                <div className="flex flex-row gap-3 items-end">
                  <Text as="h1" className="font-sans text-2xl font-bold">
                    {decodedGrade}
                  </Text>
                  <Text as="h1" className="font-sans text-lg font-normal">
                    ( 2025-2026 )
                  </Text>
                </div>
                <div className="flex flex-col gap-3">
                  <Text as="p" className="text-sm font-normal">
                    Grade level created since October 20, 2024
                  </Text>
                </div>
              </div>
            </RetroCard>

            <div className="flex flex-col gap-1 px-0">
              <Text as="h3" className="font-sans text-xl font-bold px-2">
                Overview
              </Text>
              <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
                {overviewCards.map((card) => (
                  <OverviewCard
                    key={card.title}
                    title={card.title}
                    count={card.count}
                    stat={card.stat}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1 px-0">
              <Text as="h3" className="font-sans text-xl font-bold px-2">
                Subjects
              </Text>
              <div className="flex flex-col gap-3">
                {gradeSubjects.map((subject, i) => (
                  <SubjectItemLine
                    key={i}
                    subject={subject.title}
                    date={subject.count}
                    onClick={() => navigate(`/admin/subjects/${encodeURIComponent(decodedGrade)}/${encodeURIComponent(subject.title)}`)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
