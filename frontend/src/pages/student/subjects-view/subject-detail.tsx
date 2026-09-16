import { useState } from "react";
import { BookOpen, ClipboardList } from "lucide-react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Tabs } from "@/components/retroui/Tabs";
import SubjectLessonTab from "./tabs/subject-lesson-tab";
import SubjectClassworkTab from "./tabs/subject-classwork-tab";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";

type SubjectDetailProps = {
  subject: string;
  onBack: () => void;
};

const tabs = [
  { id: "lessons", label: "Lessons", icon: BookOpen },
  { id: "classwork", label: "Classwork", icon: ClipboardList },
];

const SubjectDetail = ({ subject, onBack }: SubjectDetailProps) => {
  const [activeTab, setActiveTab] = useState("lessons");

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <div data-page-tabs-sticky-region>
              <header className="flex min-w-0 items-center gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <Breadcrumb className="min-w-0">
                  <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-1.5 text-lg font-extrabold tracking-tight sm:gap-2 sm:text-2xl md:text-3xl hover:text-foreground!">
                    <Breadcrumb.Item className="shrink-0">
                      <Breadcrumb.Link
                        onClick={onBack}
                        className="cursor-pointer whitespace-nowrap text-lg sm:text-2xl md:text-4xl hover:text-foreground!"
                      >
                        Subjects
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item className="min-w-0">
                      <Breadcrumb.Page className="block truncate text-lg sm:text-xl md:text-3xl">
                        {subject}
                      </Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
              </header>
              <div className="sticky top-0 z-30 -mt-[1px] bg-background px-3 sm:static sm:px-4 md:px-6">
                <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
              </div>
            </div>

            <div className="border-t-1 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-4">
              <div>
                {activeTab === "lessons" && <SubjectLessonTab subject={subject} />}
                {activeTab === "classwork" && <SubjectClassworkTab />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default SubjectDetail;
