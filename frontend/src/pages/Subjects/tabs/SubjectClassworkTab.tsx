import ClassworkItem from "../../../components/ListCardItems/ClassworkItem";

const SubjectLessonTab = () => {
  return (
    <div>
      <div className="flex flex-col gap-3">
        <h3 className="text-3xl font-semibold">Classwork</h3>
        <ClassworkItem
          title="Assignment 2"
          submittedDate="October 24, 2025"
          status="Missing"
        />
      </div>
    </div>
  );
};

export default SubjectLessonTab;
