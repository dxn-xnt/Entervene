import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, SkipBack, SkipForward, Flag } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";

// TEMP mock data — replace with real fetch
const quizData = {
  title: "Second Summative Test in Science II",
  lessons: "Elements in the Periodic Table, Compounds and Mixtures",
  totalQuestions: 26,
  timeLeft: "3:45",
};

const mockQuestion = {
  text: "Which part of the cell is responsible for producing energy?",
  options: ["Nucleus", "Mitochondria", "Ribosome"],
};

const StudentQuizTake = () => {
  const navigate = useNavigate();
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  return (
    <div className="min-h-screen p-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate(-1)}
          className="hover:text-black/70 cursor-pointer"
          aria-label="Go back"
        >
          <ChevronLeft size={24} />
        </button>
        <div className="text-center">
          <p className="text-2xl font-bold">{quizData.timeLeft}</p>
          <p className="text-xs text-black/60">minutes left</p>
        </div>
        <Button className="hover:shadow-none transition-all">
          Finish Quiz
        </Button>
      </div>

      {/* Quiz header + question navigator */}
      <Card className="flex flex-col">
        <div className="text-center mb-4">
          <Card.Title className="text-xl font-bold">
            {quizData.title}
          </Card.Title>
          <p className="text-sm">
            <span className="font-semibold">Lessons:</span>{" "}
            <span className="italic">{quizData.lessons}</span>
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {Array.from({ length: quizData.totalQuestions }, (_, i) => i + 1).map(
            (num) => (
              <button
                key={num}
                onClick={() => setCurrentQuestion(num)}
                className={`size-8 rounded-md border-2 border-black text-sm font-semibold transition-colors cursor-pointer ${
                  currentQuestion === num
                    ? "bg-[#F6E9B2] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    : "bg-white hover:bg-black/5"
                }`}
              >
                {num}
              </button>
            ),
          )}
        </div>
      </Card>

      {/* Prev / Flag / Next controls */}
      <div className="flex items-center justify-between px-12 py-4 md:px-24">
        <button
          onClick={() => setCurrentQuestion((q) => Math.max(1, q - 1))}
          className="flex size-9 items-center justify-center rounded-full border-2 border-black bg-white hover:bg-black/5 cursor-pointer"
          aria-label="Previous question"
        >
          <SkipBack size={16} />
        </button>
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            className="border rounded-lg bg-white flex items-center gap-2 hover:bg-gray-100 transition-all cursor-pointer"
          >
            <Flag size={14} className="fill-red-500 text-red-500" />
            Flag Question
          </Button>

          <button
            onClick={() =>
              setCurrentQuestion((q) =>
                Math.min(quizData.totalQuestions, q + 1),
              )
            }
            className="flex size-9 items-center justify-center rounded-full border-2 border-black bg-white hover:bg-black/5 cursor-pointer"
            aria-label="Next question"
          >
            <SkipForward size={16} />
          </button>
        </div>
      </div>

      {/* Question card */}
      <div className="px-12 md:px-24">
        <Card className="bg-[#F6E9B2] flex justify-center items-center">
          <p className="text-center text-lg font-semibold">
            {mockQuestion.text}
          </p>
        </Card>
      </div>

      {/* Answer options */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 px-12 py-6 md:px-24">
        {mockQuestion.options.map((option) => (
          <Card
            key={option}
            onClick={() => setSelectedOption(option)}
            className={`cursor-pointer flex items-center justify-center p-8 text-center text-lg font-semibold transition-all hover:shadow-none ${
              selectedOption === option ? "bg-[#F6E9B2]" : "bg-white"
            }`}
          >
            {option}
          </Card>
        ))}
      </div>
    </div>
  );
};

export default StudentQuizTake;
