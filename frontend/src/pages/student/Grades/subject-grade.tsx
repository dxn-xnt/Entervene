import AppLayout from "@/layouts/app-layout";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";

type SubjectGradeProps = {
  subject: string;
  onBack: () => void;
};

const SubjectGrade = ({ subject, onBack }: SubjectGradeProps) => {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center gap-3 pb-4 -mx-4 md:-mx-6 px-4 md:px-6 border-b border-gray-500">
              <Breadcrumb>
                <Breadcrumb.List>
                  <Breadcrumb.Item>
                    <Breadcrumb.Link
                      onClick={onBack}
                      className="text-2xl md:text-4xl text-black/50 hover:text-black cursor-pointer"
                    >
                      Grades
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page className="text-2xl">
                      {subject}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <main></main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default SubjectGrade;
