import { useParams, useNavigate } from "react-router-dom";
import { FileText, Presentation, Video } from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";

type MasteryLevel = "Low" | "Moderate" | "High";

interface Resource {
  title: string;
  author: string;
  type: "Docx" | "Pptx" | "Video";
  description: string;
}

interface Topic {
  title: string;
  description: string;
  mastery: MasteryLevel;
  resources: Resource[];
}

const masteryEmoji: Record<MasteryLevel, string> = {
  Low: "😞",
  Moderate: "😐",
  High: "😊",
};

const typeStyles: Record<Resource["type"], string> = {
  Docx: "bg-green-400",
  Pptx: "bg-red-400",
  Video: "bg-blue-400",
};

const typeIcons: Record<Resource["type"], typeof FileText> = {
  Docx: FileText,
  Pptx: Presentation,
  Video: Video,
};

const topics: Topic[] = [
  {
    title: "Data Types and Variables",
    description:
      "Spend extra time reviewing this topic before your intervention quiz.",
    mastery: "Low",
    resources: [
      {
        title: "Basic Data Types and Variable Notes",
        author: "John Doe",
        type: "Docx",
        description: "Reading material assigned to the lesson by the teacher.",
      },
      {
        title: "Introduction to Data Types Presentation",
        author: "John Doe",
        type: "Pptx",
        description: "Reading material assigned to the lesson by the teacher.",
      },
      {
        title: "How To Learn Programming for BEGINNERS! (2022/2023)",
        author: "CreatCode",
        type: "Video",
        description:
          "This simple tutorial will teach you how you can learn computer programming and teach yourself code.",
      },
    ],
  },
  {
    title: "Control Structures and Decision Making",
    description:
      "Review this topic to strengthen your understanding before the quiz.",
    mastery: "Moderate",
    resources: [
      {
        title: "Introduction to Data Types Presentation",
        author: "John Doe",
        type: "Pptx",
        description: "Reading material assigned to the lesson by the teacher.",
      },
      {
        title: "C Programming for Beginners",
        author: "Programiz",
        type: "Video",
        description:
          "Step by step video tutorials to learn C Programming for absolute beginners!",
      },
    ],
  },
];

export default function TodoView() {
  const { subject, quizTitle } = useParams();
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center gap-3 pb-4 -mx-4 md:-mx-6 px-4 md:px-6 border-b border-gray-500">
              <SidebarTrigger className="md:hidden" />
              <Breadcrumb>
                <Breadcrumb.List>
                  <Breadcrumb.Item>
                    <Breadcrumb.Link
                      onClick={() => navigate("/student/todo")}
                      className="text-2xl md:text-4xl text-black/50 hover:text-black cursor-pointer"
                    >
                      To do
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Link
                      onClick={() => navigate(-1)}
                      className="text-2xl md:text-4xl text-black/50 hover:text-black cursor-pointer"
                    >
                      {subject ?? "Computer Programming"}
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page className="text-2xl md:text-4xl font-bold">
                      {quizTitle ?? "Summative Test Review"}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <h2 className="text-xl md:text-2xl font-semibold">
              Topics to Review
            </h2>

            <div className="flex flex-col gap-6">
              {topics.map((topic, i) => (
                <div key={i} className="flex flex-col gap-4">
                  <div key={i} className="flex flex-col gap-4">
                    <Card className="w-full border-black flex items-start justify-between gap-4 transition-none hover:shadow-md">
                      <div>
                        <h3 className="text-lg font-bold">{topic.title}</h3>
                        <p className="text-sm text-black/60">
                          {topic.description}
                        </p>
                      </div>
                      <div className="flex flex-col items-center border-2 border-black rounded-md px-3 py-1 shrink-0">
                        <span className="text-xs text-black/60">
                          Mastery level
                        </span>
                        <span className="text-xs font-semibold">
                          {masteryEmoji[topic.mastery]} {topic.mastery}
                        </span>
                      </div>
                    </Card>

                    <div className="flex flex-col gap-3 px-8">
                      {topic.resources.map((res, j) => {
                        const Icon = typeIcons[res.type];
                        return (
                          <Card
                            key={j}
                            className="w-full border-black flex gap-3 p-2"
                          >
                            <div className="relative w-28 h-20 shrink-0 rounded overflow-hidden border-2 border-black bg-gray-50 flex items-center justify-center">
                              <Icon size={28} className="text-black/40" />
                              <span
                                className={`absolute bottom-1 left-1 text-[10px] font-semibold px-1 rounded ${typeStyles[res.type]}`}
                              >
                                {res.type}
                              </span>
                            </div>
                            <div className="flex flex-col justify-center">
                              <p className="font-semibold text-sm">
                                {res.title}
                              </p>
                              <p className="text-xs text-black/60">
                                by {res.author}
                              </p>
                              <p className="text-xs italic text-black/50 line-clamp-2">
                                {res.description}
                              </p>
                            </div>
                          </Card>
                        );
                      })}

                      <button className="self-end text-sm font-semibold hover:underline cursor-pointer">
                        View Lesson
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
