import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import { Avatar } from "@/components/retroui/Avatar";
import { Badge } from "@/components/retroui/Badge";

export default function AdminStudentView() {
    return (
        <AppLayout>
            <div className="flex flex-1 flex-col">
                <div className="@container/main flex flex-1 flex-col gap-2">
                    <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">

                        {/* Breadcrumb Header */}
                        <header className="flex items-center gap-3">
                            <SidebarTrigger className="md:hidden" />
                            <Breadcrumb>
                                <Breadcrumb.List className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-black flex items-center gap-2">
                                    <Breadcrumb.Item>
                                        <Breadcrumb.Link href="/admin/classes" className="text-muted-foreground">Classes</Breadcrumb.Link>
                                    </Breadcrumb.Item>
                                    <Breadcrumb.Separator />
                                    <Breadcrumb.Item>
                                        <Breadcrumb.Link href="/admin/classes" className="text-xl text-muted-foreground">Students</Breadcrumb.Link>
                                    </Breadcrumb.Item>
                                    <Breadcrumb.Separator />
                                    <Breadcrumb.Item>
                                        <Breadcrumb.Page className="text-black font-extrabold">Daniel Victor Santos</Breadcrumb.Page>
                                    </Breadcrumb.Item>
                                </Breadcrumb.List>
                            </Breadcrumb>
                        </header>
                        <div className="-mx-4 md:-mx-6 border-b border-black/40" />

                        {/* Student Banner Card */}
                        <Card className="w-full flex flex-col p-6 border-2 border-black rounded-lg shadow-md bg-white">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">

                                {/* Profile info */}
                                <div className="flex items-center gap-4">
                                    <Avatar className="h-16 w-16 border-2 border-black bg-[#fae583]">
                                        <Avatar.Fallback className="text-black font-bold bg-[#fae583]">
                                            {/* SVG avatar representing a student like in the image */}
                                            <svg viewBox="0 0 100 100" className="w-full h-full p-1">
                                                <circle cx="50" cy="42" r="22" fill="#e0a96d" stroke="black" strokeWidth="2" />
                                                {/* hair */}
                                                <path d="M28 40 C28 20, 72 20, 72 40" fill="#5c4033" stroke="black" strokeWidth="2" />
                                                {/* glasses */}
                                                <circle cx="42" cy="42" r="7" fill="none" stroke="black" strokeWidth="2" />
                                                <circle cx="58" cy="42" r="7" fill="none" stroke="black" strokeWidth="2" />
                                                <line x1="49" y1="42" x2="51" y2="42" stroke="black" strokeWidth="2" />
                                                {/* smile */}
                                                <path d="M45 52 Q50 56 55 52" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" />
                                                {/* body */}
                                                <path d="M25 80 C25 65, 75 65, 75 80" fill="#e06666" stroke="black" strokeWidth="2" />
                                            </svg>
                                        </Avatar.Fallback>
                                    </Avatar>
                                    <div>
                                        <h2 className="text-2xl md:text-3xl font-extrabold text-black">Daniel Victor Santos</h2>
                                        <p className="text-muted-foreground font-medium">Computer Programming</p>
                                    </div>
                                </div>

                                {/* Status Alert */}
                                <div className="text-right self-end md:self-auto">
                                    <div className="text-3xl md:text-4xl font-extrabold text-[#e63946] tracking-tight">Likely to Fail</div>
                                    <div className="text-muted-foreground font-semibold text-sm">81% model confidence</div>
                                </div>
                            </div>

                            {/* Risk bar */}
                            <div className="mt-6">
                                <Progress
                                    value={81}
                                    className="h-4 w-full bg-white border-2 border-black rounded-none [&>div]:bg-[#e63946] transition-all"
                                />
                            </div>
                        </Card>

                        {/* Three Column Grid layout */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

                            {/* COLUMN 1 (Insights & Subject Overview) - 5 Cols */}
                            <div className="lg:col-span-5 flex flex-col gap-6 w-full">

                                {/* Insights */}
                                <div className="flex flex-col gap-2">
                                    <h3 className="text-2xl font-extrabold text-black">Insights</h3>
                                    <Card className="w-full bg-[#f2a2a2] border-2 border-black rounded-lg p-5 text-black shadow-md hover:shadow-none transition-all">
                                        <p className="font-semibold text-sm leading-relaxed">
                                            Daniel's data indicates significant disengagement across all LMS behavioral indicators. With only 8 logins and an average session of 6 minutes, meaningful content exposure is critically low. Combined with failing classwork and quiz averages and 11 missed activities, the model predicts failure with high confidence unless urgent intervention is applied.
                                        </p>
                                    </Card>
                                </div>

                                {/* Subject Overview */}
                                <div className="flex flex-col gap-2">
                                    <h3 className="text-2xl font-extrabold text-black">Subject Overview</h3>

                                    {/* Stats rows */}
                                    <div className="grid grid-cols-3 gap-3">
                                        <Card className="bg-white border-2 border-black rounded-lg p-3 shadow-md flex flex-col justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-muted-foreground leading-tight">Written Works Average</p>
                                                <div className="text-3xl sm:text-4xl font-extrabold text-black mt-2">52</div>
                                            </div>
                                            <p className="text-[10px] font-semibold text-muted-foreground mt-2">out of 100</p>
                                        </Card>

                                        <Card className="bg-white border-2 border-black rounded-lg p-3 shadow-md flex flex-col justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-muted-foreground leading-tight">Performance Average</p>
                                                <div className="text-3xl sm:text-4xl font-extrabold text-black mt-2">48</div>
                                            </div>
                                            <p className="text-[10px] font-semibold text-muted-foreground mt-2">out of 100</p>
                                        </Card>

                                        <Card className="bg-white border-2 border-black rounded-lg p-3 shadow-md flex flex-col justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-muted-foreground leading-tight">Completion Rate</p>
                                                <div className="text-3xl sm:text-4xl font-extrabold text-black mt-2">44%</div>
                                            </div>
                                            <p className="text-[10px] font-semibold text-muted-foreground mt-2">activities done</p>
                                        </Card>
                                    </div>

                                    {/* Subgrid: Lesson Mastery & Score Trend */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                                        {/* Lesson Mastery */}
                                        <Card className="bg-white border-2 border-black rounded-lg p-4 shadow-md flex flex-col gap-4">
                                            <h4 className="font-extrabold text-black border-b-2 border-black pb-2 text-sm sm:text-base">Lesson Mastery</h4>
                                            <div className="flex flex-col gap-3">

                                                {/* Functions and Mo... */}
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex justify-between items-center text-xs font-bold text-black">
                                                        <span className="truncate max-w-[75%]">Functions and Mo...</span>
                                                        <span>96%</span>
                                                    </div>
                                                    <Progress value={96} className="h-3 w-full bg-white border-2 border-black rounded-none [&>div]:bg-[#387a22]" />
                                                </div>

                                                {/* Control Structures... */}
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex justify-between items-center text-xs font-bold text-black">
                                                        <span className="truncate max-w-[75%]">Control Structures...</span>
                                                        <span>80%</span>
                                                    </div>
                                                    <Progress value={80} className="h-3 w-full bg-white border-2 border-black rounded-none [&>div]:bg-[#f39c12]" />
                                                </div>

                                                {/* Data Types and V... */}
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex justify-between items-center text-xs font-bold text-black">
                                                        <span className="truncate max-w-[75%]">Data Types and V...</span>
                                                        <span>54%</span>
                                                    </div>
                                                    <Progress value={54} className="h-3 w-full bg-white border-2 border-black rounded-none [&>div]:bg-[#e63946]" />
                                                </div>

                                            </div>
                                        </Card>

                                        {/* Score Trend */}
                                        <Card className="bg-white border-2 border-black rounded-lg p-4 shadow-md flex flex-col gap-2">
                                            <h4 className="font-extrabold text-black border-b-2 border-black pb-2 text-sm sm:text-base">Score Trend</h4>
                                            <div className="flex-1 min-h-[100px] flex items-center justify-center relative">
                                                {/* SVG Line Chart representing the trend */}
                                                <svg viewBox="0 0 100 50" className="w-full h-full">
                                                    <line x1="5" y1="45" x2="95" y2="45" stroke="#cccccc" strokeWidth="1" strokeDasharray="2,2" />
                                                    <line x1="5" y1="5" x2="5" y2="45" stroke="#cccccc" strokeWidth="1" strokeDasharray="2,2" />

                                                    {/* Downward trend line */}
                                                    <path
                                                        d="M 10 10 L 35 25 L 60 20 L 90 40"
                                                        fill="none"
                                                        stroke="#e63946"
                                                        strokeWidth="2.5"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />

                                                    {/* Dots */}
                                                    <circle cx="10" cy="10" r="3" fill="#e63946" stroke="black" strokeWidth="1" />
                                                    <circle cx="35" cy="25" r="3" fill="#e63946" stroke="black" strokeWidth="1" />
                                                    <circle cx="60" cy="20" r="3" fill="#e63946" stroke="black" strokeWidth="1" />
                                                    <circle cx="90" cy="40" r="3" fill="#e63946" stroke="black" strokeWidth="1" />
                                                </svg>
                                            </div>
                                        </Card>
                                    </div>
                                </div>
                            </div>

                            {/* COLUMN 2 (Recommendations) - 4 Cols */}
                            <div className="lg:col-span-4 flex flex-col gap-2 w-full">
                                <h3 className="text-2xl font-extrabold text-black">Recommendations</h3>
                                <Card className="w-full bg-white border-2 border-black rounded-lg p-5 shadow-md flex flex-col gap-4">

                                    {/* List of recommendations */}
                                    <ul className="list-disc pl-5 flex flex-col gap-3 text-black text-sm font-semibold leading-relaxed">
                                        <li>
                                            <strong>Access audit</strong> — verify the student has reliable internet and device access; technical barriers may explain low LMS usage.
                                        </li>
                                        <li>
                                            <strong>Incomplete work recovery</strong> — allow submission of missing activities under a structured catch-up plan.
                                        </li>
                                        <li>
                                            <strong>Daily engagement tracking</strong> — set up manual or automated daily check-ins to monitor any improvement in activity.
                                        </li>
                                    </ul>

                                    <hr className="border-black border-t-2 my-2" />

                                    {/* Additional Learning Material */}
                                    <div className="flex flex-col gap-3">
                                        <h4 className="font-extrabold text-black text-sm sm:text-base">Additional Learning Material</h4>

                                        {/* Learning cards */}
                                        <div className="flex flex-col gap-3">

                                            {/* Card 1 */}
                                            <div className="border-2 border-black rounded-lg p-3 bg-white flex gap-3 relative shadow hover:shadow-none transition-all">
                                                <div className="w-20 h-16 bg-[#e06666] border border-black flex-shrink-0 flex items-center justify-center overflow-hidden rounded relative">
                                                    {/* Video illustration */}
                                                    <div className="absolute inset-0 bg-[#351c75] opacity-80 flex flex-col items-center justify-center p-1 text-[8px] text-white text-center font-bold">
                                                        <span>Learn</span>
                                                        <span>To</span>
                                                        <span>Program</span>
                                                    </div>
                                                </div>
                                                <div className="flex-1 flex flex-col min-w-0">
                                                    <span className="font-extrabold text-xs text-black truncate">How To Learn Programming f...</span>
                                                    <span className="text-[10px] text-muted-foreground font-semibold">by CroatCode</span>
                                                    <p className="text-[9px] text-black font-medium leading-tight mt-1 line-clamp-2">This simple tutorial will teach you how you can learn computer programming and teach yourself code. Learning code is</p>
                                                </div>
                                                <div className="absolute bottom-2 right-2">
                                                    <Badge variant="surface" size="sm" className="bg-[#a3e635] text-black border border-black font-extrabold py-0.5 px-1.5 rounded">Assigned</Badge>
                                                </div>
                                            </div>

                                            {/* Card 2 */}
                                            <div className="border-2 border-black rounded-lg p-3 bg-white flex gap-3 relative shadow hover:shadow-none transition-all">
                                                <div className="w-20 h-16 bg-[#3d85c6] border border-black flex-shrink-0 flex items-center justify-center overflow-hidden rounded relative">
                                                    {/* Video illustration */}
                                                    <div className="absolute inset-0 bg-[#073763] opacity-80 flex flex-col items-center justify-center p-1 text-[8px] text-white text-center font-bold">
                                                        <span>C</span>
                                                        <span>Prog</span>
                                                    </div>
                                                </div>
                                                <div className="flex-1 flex flex-col min-w-0">
                                                    <span className="font-extrabold text-xs text-black truncate">C Programming for Beginners</span>
                                                    <span className="text-[10px] text-muted-foreground font-semibold">by Programiz</span>
                                                    <p className="text-[9px] text-black font-medium leading-tight mt-1 line-clamp-2">Step by step video tutorials to learn C Programming for absolute beginners! In this video, we will introduce</p>
                                                </div>
                                                <div className="absolute bottom-2 right-2">
                                                    <Badge variant="surface" size="sm" className="bg-[#a3e635] text-black border border-black font-extrabold py-0.5 px-1.5 rounded">Assigned</Badge>
                                                </div>
                                            </div>

                                        </div>

                                        <span className="text-[10px] font-semibold text-muted-foreground">Recommended supplementary learning materials based on the student's weak topics.</span>
                                    </div>

                                </Card>
                            </div>

                            {/* COLUMN 3 (LMS Behavior) - 3 Cols */}
                            <div className="lg:col-span-3 flex flex-col gap-2 w-full">
                                <h3 className="text-2xl font-extrabold text-black">LMS Behavior</h3>
                                <div className="flex flex-col gap-3">

                                    {/* Total logins */}
                                    <Card className="bg-white border-2 border-black rounded-lg p-4 shadow-md hover:shadow-none transition-all">
                                        <span className="text-xs font-bold text-muted-foreground">Total logins <span className="font-medium text-[10px]">(this period)</span></span>
                                        <div className="text-4xl font-extrabold text-black mt-2">8</div>
                                    </Card>

                                    {/* Avg session */}
                                    <Card className="bg-white border-2 border-black rounded-lg p-4 shadow-md hover:shadow-none transition-all">
                                        <span className="text-xs font-bold text-muted-foreground">Avg session <span className="font-medium text-[10px]">(per login)</span></span>
                                        <div className="text-4xl font-extrabold text-black mt-2">6 <span className="text-xl font-bold">min</span></div>
                                    </Card>

                                    {/* Missed activities */}
                                    <Card className="bg-white border-2 border-black rounded-lg p-4 shadow-md hover:shadow-none transition-all">
                                        <span className="text-xs font-bold text-muted-foreground">Missed activities</span>
                                        <div className="text-4xl font-extrabold text-black mt-2">11</div>
                                    </Card>

                                </div>
                            </div>

                        </div>

                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
