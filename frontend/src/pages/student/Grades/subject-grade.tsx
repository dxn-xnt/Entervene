import AppLayout from "@/layouts/app-layout";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";

type SubjectGradeProps = {
  subject: string;
  onBack: () => void;
};

const SubjectGrade = ({ subject, onBack }: SubjectGradeProps) => {
  return (
    <AppLayout>
      <header className="px-5 py-5 flex items-center gap-3 border-b border-gray-500">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item>
              <Breadcrumb.Link
                onClick={onBack}
                className="text-3xl text-black/50 hover:text-black cursor-pointer"
              >
                Grades
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator />
            <Breadcrumb.Item>
              <Breadcrumb.Page className="text-2xl">{subject}</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </header>
      <main className="px-5 py-5"></main>
    </AppLayout>
  );
};

export default SubjectGrade;
