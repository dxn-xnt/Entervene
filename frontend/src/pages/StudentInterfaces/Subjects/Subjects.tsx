import Card from "../../../components/StudentUIComponents/Card";

type SubjectsProps = {
  onSelectSubject: (title: string) => void;
};

const Subjects = ({ onSelectSubject }: SubjectsProps) => {
  return (
    <div>
      <header className="px-5 py-5 border-b border-gray-500">
        <h1 className="text-4xl font-semibold">Subjects</h1>
      </header>
      <main className="px-5 py-5 flex flex-row gap-4 min-h-screen">
        <div className="grid grid-cols-3 gap-4 self-start w-full">
          <Card
            title="Computer Programming"
            onClick={() => onSelectSubject("Computer Programming")}
            teacher="Juan Dela Cruz"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Assignments", count: 2 },
              { label: "Activities", count: 1 },
            ]}
          />
          <Card
            title="English"
            onClick={() => onSelectSubject("English")}
            teacher="Juan Dela Cruz"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Assignments", count: 2 },
              { label: "Activities", count: 1 },
            ]}
          />
          <Card
            title="Science & Technology"
            onClick={() => onSelectSubject("Science & Technology")}
            teacher="Juan Dela Cruz"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Assignments", count: 2 },
              { label: "Activities", count: 1 },
            ]}
          />
          <Card
            title="Mathematics"
            onClick={() => onSelectSubject("Mathematics")}
            teacher="Juan Dela Cruz"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Assignments", count: 2 },
              { label: "Activities", count: 1 },
            ]}
          />
          <Card
            title="Filipino"
            onClick={() => onSelectSubject("Filipino")}
            teacher="Juan Dela Cruz"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Assignments", count: 2 },
              { label: "Activities", count: 1 },
            ]}
          />
        </div>
      </main>
    </div>
  );
};

export default Subjects;
