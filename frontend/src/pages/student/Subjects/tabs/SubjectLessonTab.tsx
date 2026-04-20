import SubjectCardHeader from "../../../../components/StudentUIComponents/SubjectCardHeader";

type SubjectLessonTabProps = {
  subject: string;
};

const SubjectLessonTab = ({ subject }: SubjectLessonTabProps) => {
  return (
    <div className="flex flex-col gap-4">
      <SubjectCardHeader
        title={subject}
        teacher="Raymart Gabutan"
      />
    </div>
  );
};

export default SubjectLessonTab;