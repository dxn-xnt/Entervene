import { useState } from "react";
import SubjectCardHeader from "../../../components/StudentUIComponents/SubjectCardHeader";
import SubjectGrade from "./SubjectGrade";
import AppLayout from "@/layouts/app-layout";

const subjectPerformanceData = [
  { subject: "Mathematic..", score: 87 },
  { subject: "System Des..", score: 89 },
  { subject: "Science", score: 94 },
  { subject: "Filipino", score: 94 },
  { subject: "English", score: 97 },
  { subject: "Computer P..", score: 99 },
];

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
    <AppLayout>
      <header className="px-5 py-5 border-b border-gray-500">
        <h1 className="text-4xl font-semibold">Grades</h1>
      </header>
      <main className="px-5 py-5">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="border border-black rounded-lg p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Performance Rate</h2>
              <select className="border border-black rounded px-2 py-1 text-xs bg-white">
                <option>Science</option>
                <option>English</option>
                <option>Mathematics</option>
                <option>Computer Programming</option>
                <option>System Designs</option>
                <option>Filipino</option>
              </select>
            </div>
            <div className="h-36 flex items-end gap-1 border-b border-l border-gray-300 relative px-2">
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                <div className="border-b border-gray-200 border-dashed w-full"></div>
                <div className="border-b border-gray-200 border-dashed w-full"></div>
                <div className="border-b border-gray-200 border-dashed w-full"></div>
                <div className="border-b border-gray-200 border-dashed w-full"></div>
              </div>
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 140" preserveAspectRatio="none">
                <polyline points="20,100 100,80 180,50 260,70" fill="none" stroke="#F59E0B" strokeWidth="2" />
                <polyline points="20,110 100,90 180,70 260,40" fill="none" stroke="#EF4444" strokeWidth="2" />
                <polyline points="20,90 100,60 180,40 260,30" fill="none" stroke="#22C55E" strokeWidth="2" />
                <polyline points="20,120 100,100 180,85 260,60" fill="none" stroke="#EAB308" strokeWidth="2" />
                <polyline points="20,80 100,70 180,90 260,50" fill="none" stroke="#3B82F6" strokeWidth="2" />
              </svg>
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-gray-600 px-2">
              <span>Jan</span>
              <span>Feb</span>
              <span>Mar</span>
              <span>Apr</span>
            </div>

            <div className="flex flex-wrap gap-x-2 gap-y-1 mt-2 text-[9px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#F59E0B] inline-block"></span>Computer Programming</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#EF4444] inline-block"></span>English</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#22C55E] inline-block"></span>Science</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#EAB308] inline-block"></span>Mathematics</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#3B82F6] inline-block"></span>System</span>
            </div>
          </div>

          <div className="border border-black rounded-lg p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white">
            <h2 className="text-lg font-semibold mb-4">Classwork Distribution</h2>
            <div className="flex items-center justify-center">
              <div className="relative w-36 h-36">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="transparent" stroke="#EF4444" strokeWidth="20"
                    strokeDasharray="62.8 188.4" strokeDashoffset="0" />
                  <circle cx="50" cy="50" r="40" fill="transparent" stroke="#F59E0B" strokeWidth="20"
                    strokeDasharray="50.2 200.9" strokeDashoffset="-62.8" />
                  <circle cx="50" cy="50" r="40" fill="transparent" stroke="#22C55E" strokeWidth="20"
                    strokeDasharray="75.4 175.8" strokeDashoffset="-113" />
                  <circle cx="50" cy="50" r="40" fill="transparent" stroke="#F97316" strokeWidth="20"
                    strokeDasharray="62.8 188.4" strokeDashoffset="-188.4" />
                </svg>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#EF4444] inline-block"></span>Readings</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#F59E0B] inline-block"></span>Quizzes</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#22C55E] inline-block"></span>Assignments</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#F97316] inline-block"></span>Activities</span>
            </div>
          </div>

          <div className="border border-black rounded-lg p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white">
            <h2 className="text-lg font-semibold mb-3">Subject Performance</h2>
            <div className="flex flex-col gap-2">
              {subjectPerformanceData.map((item) => (
                <div key={item.subject} className="flex items-center gap-2">
                  <span className="text-[10px] w-20 truncate">{item.subject}</span>
                  <div className="flex-1 bg-gray-200 rounded-full h-3 relative">
                    <div
                      className="bg-[#D4A017] h-3 rounded-full"
                      style={{ width: `${item.score}%` }}
                    ></div>
                  </div>
                  <span className="text-[10px] font-semibold w-6 text-right">{item.score}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] mt-3 text-gray-600">
              Recommended Attention: <span className="font-bold">Mathematics</span>
            </p>
          </div>
        </div>

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
            gradedCount="5"
            label="Graded Classwork"
            onClick={() => setSelectedSubject("English")}
          />
          <SubjectCardHeader
            title="Science"
            teacher="Raymart Gabutan"
            gradedCount="16"
            label="Graded Classwork"
            onClick={() => setSelectedSubject("Science")}
          />
          <SubjectCardHeader
            title="System Designs"
            teacher="Raymart Gabutan"
            gradedCount="3"
            label="Graded Classwork"
            onClick={() => setSelectedSubject("System Designs")}
          />
          <SubjectCardHeader
            title="Mathematics"
            teacher="Raymart Gabutan"
            gradedCount="12"
            label="Graded Classwork"
            onClick={() => setSelectedSubject("Mathematics")}
          />
        </div>
      </main>
    </AppLayout>
  );
};

export default Grades;
