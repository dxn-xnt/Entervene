import { useState } from "react";
import SubjectCardHeader from "../../../components/StudentUIComponents/SubjectCardHeader";
import SubjectGrade from "./SubjectGrade";

const Grades = () => {
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);

  if (selectedSubject) {
    return (
      <SubjectGrade
        subject={selectedSubject}
        onBack={() => setSelectedSubject(null)}
      />
    );
  }

  return (
    <div>
      <header className="px-5 py-5 border-b border-gray-500">
        <h1 className="text-4xl font-semibold">Grades</h1>
      </header>
      <main className="px-5 py-5">
        <div className="flex flex-col gap-4">
          <SubjectCardHeader
            title="Computer Programming"
            teacher="Raymart Gabutan"
            gradedCount="7"
            label="Graded Classwork"
            onClick={() => setSelectedSubject("Computer Programming")}
          />
          <SubjectCardHeader
            title="English"
            teacher="Raymart Gabutan"
            gradedCount="7"
            label="Graded Classwork"
            onClick={() => setSelectedSubject("English")}
          />
          <SubjectCardHeader
            title="Science"
            teacher="Raymart Gabutan"
            gradedCount="7"
            label="Graded Classwork"
            onClick={() => setSelectedSubject("Science")}
          />
          <SubjectCardHeader
            title="System Designs"
            teacher="Raymart Gabutan"
            gradedCount="7"
            label="Graded Classwork"
            onClick={() => setSelectedSubject("System Designs")}
          />
          <SubjectCardHeader
            title="Mathematics"
            teacher="Raymart Gabutan"
            gradedCount="7"
            label="Graded Classwork"
            onClick={() => setSelectedSubject("Mathematics")}
          />
        </div>
      </main>
    </div>
  );
};

export default Grades;
