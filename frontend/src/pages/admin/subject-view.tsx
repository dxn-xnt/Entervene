import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card as RetroCard } from "@/components/retroui/Card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Text } from "@/components/retroui/Text";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { OverviewCard } from "@/components/overview-cards";
import ClassItemLine from "@/components/item-line/class";

export default function AdminSubjectView() {
  const overviewCards = [
    { title: "Students", count: "1402", stat: "12" },
    { title: "Teachers", count: "123", stat: "12" },
    { title: "Classes", count: "92", stat: "12" },
    { title: "Subjects", count: "67", stat: "12" },
  ];


  const gradeClasses = [
    { title: "Sapphire", count: "Assigned since November 10, 2025", time: "7:00 AM - 8:00 AM", schedule: ["Monday", "Wednesday", "Friday"] },
    { title: "Ruby", count: "Assigned since November 10, 2025", time: "7:00 AM - 8:00 AM", schedule: ["Monday", "Wednesday", "Friday"] },
    { title: "Emerald", count: "Assigned since November 10, 2025", time: "7:00 AM - 8:00 AM", schedule: ["Monday", "Wednesday", "Friday"] },
    { title: "Diamond", count: "Assigned since November 10, 2025", time: "7:00 AM - 8:00 AM", schedule: ["Monday", "Wednesday", "Friday"] },
  ];

  const { grade, subject } = useParams<{ grade: string; subject: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const decodedGrade = decodeURIComponent(grade || "Grade 7");
  const decodedSubject = decodeURIComponent(subject || "Subject");

  const state = location.state as { subject?: { title: string; count: string }; grade?: string } | null;
  const subjectData = state?.subject || { title: decodedSubject, count: "Assigned since November 10, 2025" };

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
                      <Breadcrumb.Link href="/admin/subjects" className="text-2xl">
                        Subjects
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Link href={`/admin/subjects/${encodeURIComponent(decodedGrade)}`}>
                        {decodedGrade}
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Page>{decodedSubject}</Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>
            </header>
            <div className="-mx-4 md:-mx-6 border-b border-black/40" />

            <RetroCard className="py-3 px-4 bg-accent">
              <div className="flex flex-col gap-1">
                <div className="flex flex-row gap-3 items-end">
                  <Text as="h1" className="font-sans text-2xl font-bold">
                    {decodedSubject}
                  </Text>
                </div>
                <div className="flex flex-col gap-3">
                  <Text as="p" className="text-sm font-normal">
                    Subject created since October 20, 2024
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
                Classes
              </Text>
              <div className="flex flex-col gap-3">
                {gradeClasses.map((cls, i) => (
                  <ClassItemLine
                    key={i}
                    subject={cls.title}
                    date={cls.count}
                    time={cls.time}
                    schedule={cls.schedule}
                    onClick={() => navigate(`/admin/subjects/${encodeURIComponent(decodedGrade)}/${encodeURIComponent(decodedSubject)}`, { state: { subject: { title: decodedSubject, count: cls.count }, grade: decodedGrade } })}
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
