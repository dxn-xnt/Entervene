import SubjectCardHeader from "../components/SubjectCardHeader";

const Grades = () => {
  return (
    <div>
      <header className="px-5 py-5 border-b border-gray-500">
        <h1 className="text-4xl font-semibold">Grades</h1>
      </header>
      <main className="px-5 py-5">
        <div className="flex flex-col gap-4">
          <SubjectCardHeader
            title={"Computer Programming"}
            teacher="Raymart Gabutan"
            gradedCount="7"
            label="Graded Classwork"
          />
          <SubjectCardHeader
            title={"English"}
            teacher="Raymart Gabutan"
            gradedCount="7"
            label="Graded Classwork"
          />
          <SubjectCardHeader
            title={"Science"}
            teacher="Raymart Gabutan"
            gradedCount="7"
            label="Graded Classwork"
          />
          <SubjectCardHeader
            title={"System Designs"}
            teacher="Raymart Gabutan"
            gradedCount="7"
            label="Graded Classwork"
          />
          <SubjectCardHeader
            title={"Mathematics"}
            teacher="Raymart Gabutan"
            gradedCount="7"
            label="Graded Classwork"
          />
        </div>
      </main>
    </div>
  );
};

export default Grades;
