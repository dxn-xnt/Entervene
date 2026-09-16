import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datetime import datetime, timezone, timedelta
from decimal import Decimal

from app.db.Session import SessionLocal
from app.models.auth.UserAccount import UserAccount
from app.models.people.Student import Student
from app.models.people.AcademicStaff import AcademicStaff
from app.models.academic import (
    Subject,
    Class,
    StudentClass,
    SubjectOffering,
    SubjectLoad,
    AcademicLevel,
    AcademicYear,
    AcademicPeriod,
)
from app.models.classwork import Classwork, ClassworkAssignment
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption


def populate_manuel_subjects_and_classworks():
    db = SessionLocal()
    now = datetime.now(timezone.utc)

    # 1. Verify User and Student
    user = db.query(UserAccount).filter(UserAccount.email == "manuel.garcia@student.ph").first()
    student = db.query(Student).filter(Student.email == "manuel.garcia@student.ph").first()

    if not user:
        print("ERROR: User manuel.garcia@student.ph not found in UserAccount!")
        return
    if not student:
        print("ERROR: Student with email manuel.garcia@student.ph not found!")
        return

    # Ensure link between student and user
    if student.user_id != user.user_id:
        student.user_id = user.user_id
        db.commit()

    print(f"Student: {student.first_name} {student.last_name} (ID: {student.student_id}, User ID: {student.user_id})")

    # 2. Verify or assign Class enrollment
    # Academic Year 1, Academic Level 1 (Grade 7), Class 6 (Galileo)
    galileo_class = db.query(Class).filter(Class.class_id == 6).first()
    if not galileo_class:
        print("ERROR: Class 6 (Galileo) not found!")
        return

    enrollment = (
        db.query(StudentClass)
        .filter(
            StudentClass.student_id == student.student_id,
            StudentClass.class_id == galileo_class.class_id,
        )
        .first()
    )
    if not enrollment:
        enrollment = StudentClass(
            student_id=student.student_id,
            class_id=galileo_class.class_id,
            academic_year_id=1,
            enrollment_status="enrolled",
        )
        db.add(enrollment)
        db.commit()
        db.refresh(enrollment)
        print(f"Enrolled student into Class 6 (Galileo) with StudentClass ID {enrollment.student_class_id}")
    else:
        enrollment.enrollment_status = "enrolled"
        db.commit()
        print(f"Existing enrollment found: StudentClass ID {enrollment.student_class_id} (Status: {enrollment.enrollment_status})")

    # 3. Define the Subject Loads to configure for Class 6 (Galileo)
    # Mapping of subject_id -> (teacher_staff_id, subject_name)
    subject_teacher_configs = [
        {"subject_id": 2, "name": "Mathematics 7", "staff_id": "2026-0002"},     # Maria Cruz
        {"subject_id": 3, "name": "Science 7", "staff_id": "2026-0004"},         # Joselito Manalo
        {"subject_id": 4, "name": "English 7", "staff_id": "2026-0006"},         # Ian Dosdos
        {"subject_id": 1, "name": "Filipino 7", "staff_id": "2026-0002"},        # Maria Cruz
        {"subject_id": 20, "name": "ICT", "staff_id": "2026-0007"},              # Dan Bejec
        {"subject_id": 23, "name": "Values Education", "staff_id": "2026-0004"}, # Joselito Manalo
        {"subject_id": 28, "name": "Physical Education", "staff_id": "2026-0012"},# Raymart Gabutan
        {"subject_id": 27, "name": "Music", "staff_id": "2026-0008"},             # Juan Dela Cruz
        {"subject_id": 24, "name": "Arts", "staff_id": "2026-0009"},              # Angel Alcantara
        {"subject_id": 26, "name": "Health", "staff_id": "2026-0010"},            # Jayson Limoe
    ]

    for cfg in subject_teacher_configs:
        subj = db.query(Subject).filter(Subject.subject_id == cfg["subject_id"]).first()
        if not subj:
            print(f"Warning: Subject ID {cfg['subject_id']} ({cfg['name']}) not found in DB!")
            continue

        # Ensure subject is active
        if subj.status != "active":
            subj.status = "active"
            db.commit()

        # Ensure SubjectOffering exists
        offering = (
            db.query(SubjectOffering)
            .filter(
                SubjectOffering.subject_id == subj.subject_id,
                SubjectOffering.academic_level_id == 1,
                SubjectOffering.academic_year_id == 1,
            )
            .first()
        )
        if not offering:
            offering = SubjectOffering(
                subject_id=subj.subject_id,
                academic_level_id=1,
                academic_year_id=1,
                academic_period_id=1,
                status="active",
            )
            db.add(offering)
            db.commit()
            print(f"Created SubjectOffering for {subj.subject_name}")

        # Ensure SubjectLoad exists for Class 6 (Galileo)
        load = (
            db.query(SubjectLoad)
            .filter(
                SubjectLoad.class_id == galileo_class.class_id,
                SubjectLoad.subject_id == subj.subject_id,
            )
            .first()
        )
        if not load:
            load = SubjectLoad(
                class_id=galileo_class.class_id,
                subject_id=subj.subject_id,
                staff_id=cfg["staff_id"],
                academic_period_id=1,
                status="published",
                is_active_version=True,
            )
            db.add(load)
            db.commit()
            print(f"Created SubjectLoad for Class 6: {subj.subject_name} -> Staff {cfg['staff_id']}")
        else:
            load.staff_id = cfg["staff_id"]
            load.academic_period_id = 1
            load.status = "published"
            load.is_active_version = True
            db.commit()
            print(f"Updated SubjectLoad ID {load.subject_load_id}: {subj.subject_name} -> Staff {cfg['staff_id']} [published]")

    # 4. Create and Assign Classworks for these subjects
    classworks_data = [
        # --- MATHEMATICS 7 ---
        {
            "subject_id": 2,
            "staff_id": "2026-0002",
            "title": "Introduction to Sets, Subsets, and Venn Diagrams",
            "classwork_type": "READING",
            "classwork_category": "WRITTEN_WORK",
            "description": "Comprehensive reading module on basic set theory, defining universal sets, subsets, intersections, and unions.",
            "instructions": "Read through all sections carefully and review the illustrative Venn diagram examples.",
            "total_points": None,
            "is_graded": False,
            "due_days": None,
        },
        {
            "subject_id": 2,
            "staff_id": "2026-0002",
            "title": "Problem Set 1: Operations on Integers and Real Numbers",
            "classwork_type": "ASSIGNMENT",
            "classwork_category": "WRITTEN_WORK",
            "description": "Solve algebraic and word problems applying integer addition, subtraction, multiplication, and division.",
            "instructions": "Show complete step-by-step solutions for each problem on paper or digital document and submit your work.",
            "total_points": 50,
            "is_graded": True,
            "due_days": 4,
        },
        {
            "subject_id": 2,
            "staff_id": "2026-0002",
            "title": "Mathematics 7: Sets & Number System Quiz",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "description": "Formative evaluation testing concepts on sets, cardinality, union, and intersection.",
            "instructions": "Choose the best answer for each question. You have 30 minutes to complete the quiz.",
            "total_points": 20,
            "is_graded": True,
            "due_days": 6,
            "quiz_info": {
                "duration_minutes": 30,
                "questions": [
                    {
                        "question_text": "If Set A = {2, 4, 6, 8} and Set B = {4, 8, 12}, what is A ∩ B (intersection of A and B)?",
                        "points": 10,
                        "options": [
                            {"text": "{2, 6}", "is_correct": False},
                            {"text": "{4, 8}", "is_correct": True},
                            {"text": "{2, 4, 6, 8, 12}", "is_correct": False},
                            {"text": "∅ (Empty set)", "is_correct": False},
                        ],
                    },
                    {
                        "question_text": "Which of the following numbers is an irrational number?",
                        "points": 10,
                        "options": [
                            {"text": "3/4", "is_correct": False},
                            {"text": "0.25", "is_correct": False},
                            {"text": "√2", "is_correct": True},
                            {"text": "√16", "is_correct": False},
                        ],
                    },
                ],
            },
        },
        {
            "subject_id": 2,
            "staff_id": "2026-0002",
            "title": "Performance Task 1: Venn Diagram Real-Life Application",
            "classwork_type": "ACTIVITY",
            "classwork_category": "PERFORMANCE_TASK",
            "description": "Survey 10 of your peers or family members on their favorite subjects and construct an accurate Venn Diagram.",
            "instructions": "Create a visual poster or digital slide presenting your survey data and Venn diagram representation.",
            "total_points": 100,
            "is_graded": True,
            "due_days": 10,
        },

        # --- SCIENCE 7 ---
        {
            "subject_id": 3,
            "staff_id": "2026-0004",
            "title": "Scientific Method and Laboratory Safety Protocols",
            "classwork_type": "READING",
            "classwork_category": "WRITTEN_WORK",
            "description": "Foundational guide on scientific inquiry, developing hypotheses, control variables, and lab safety rules.",
            "instructions": "Read the laboratory manual and familiarize yourself with hazard symbols and safety procedures.",
            "total_points": None,
            "is_graded": False,
            "due_days": None,
        },
        {
            "subject_id": 3,
            "staff_id": "2026-0004",
            "title": "Worksheet: Identifying Variables in Scientific Experiments",
            "classwork_type": "ASSIGNMENT",
            "classwork_category": "WRITTEN_WORK",
            "description": "Analyze 5 experimental scenarios to identify independent, dependent, and controlled variables.",
            "instructions": "Fill in the table with your identified variables and explanations for each experiment scenario.",
            "total_points": 40,
            "is_graded": True,
            "due_days": 5,
        },
        {
            "subject_id": 3,
            "staff_id": "2026-0004",
            "title": "Science 7: Solutions, Substances, and Mixtures Quiz",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "description": "Quiz on homogeneous and heterogeneous mixtures, solute, solvent, and saturation.",
            "instructions": "Answer each multiple choice question carefully.",
            "total_points": 20,
            "is_graded": True,
            "due_days": 7,
            "quiz_info": {
                "duration_minutes": 25,
                "questions": [
                    {
                        "question_text": "In a saltwater solution, which component is considered the solute?",
                        "points": 10,
                        "options": [
                            {"text": "Water", "is_correct": False},
                            {"text": "Salt", "is_correct": True},
                            {"text": "Both salt and water", "is_correct": False},
                            {"text": "Neither", "is_correct": False},
                        ],
                    },
                    {
                        "question_text": "Which of the following is an example of a homogeneous mixture?",
                        "points": 10,
                        "options": [
                            {"text": "Oil and water", "is_correct": False},
                            {"text": "Fruit salad", "is_correct": False},
                            {"text": "Sugar completely dissolved in warm water", "is_correct": True},
                            {"text": "Sand and gravel", "is_correct": False},
                        ],
                    },
                ],
            },
        },
        {
            "subject_id": 3,
            "staff_id": "2026-0004",
            "title": "Mini-Lab: Home Experiment on Separation of Mixtures",
            "classwork_type": "ACTIVITY",
            "classwork_category": "PERFORMANCE_TASK",
            "description": "Perform simple separation techniques (decantation, filtration, evaporation) using safe kitchen materials.",
            "instructions": "Document your experiment with photos/drawings and write a 1-page lab summary.",
            "total_points": 100,
            "is_graded": True,
            "due_days": 12,
        },

        # --- ENGLISH 7 ---
        {
            "subject_id": 4,
            "staff_id": "2026-0006",
            "title": "Philippine Oral Lore and Pre-Colonial Literature",
            "classwork_type": "READING",
            "classwork_category": "WRITTEN_WORK",
            "description": "Exploration of myths, legends, proverbs (salawikain), and epics from indigenous Philippine culture.",
            "instructions": "Read the selected excerpts from the Epic of Biag ni Lam-ang and the creation myth of Malakas at Maganda.",
            "total_points": None,
            "is_graded": False,
            "due_days": None,
        },
        {
            "subject_id": 4,
            "staff_id": "2026-0006",
            "title": "Essay: Literary Analysis and Theme Identification",
            "classwork_type": "ASSIGNMENT",
            "classwork_category": "WRITTEN_WORK",
            "description": "Write a 300-word essay reflecting on cultural values conveyed in pre-colonial folk tales.",
            "instructions": "Submit a well-structured essay with an introduction, body paragraphs, and a reflective conclusion.",
            "total_points": 50,
            "is_graded": True,
            "due_days": 5,
        },
        {
            "subject_id": 4,
            "staff_id": "2026-0006",
            "title": "English 7: Subject-Verb Agreement & Analogy Quiz",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "description": "Assess mastery of standard subject-verb agreement rules and understanding analogies.",
            "instructions": "Select the grammatically correct option for each sentence.",
            "total_points": 20,
            "is_graded": True,
            "due_days": 8,
            "quiz_info": {
                "duration_minutes": 20,
                "questions": [
                    {
                        "question_text": "Neither the teacher nor the students ______ present in the auditorium.",
                        "points": 10,
                        "options": [
                            {"text": "was", "is_correct": False},
                            {"text": "were", "is_correct": True},
                            {"text": "is", "is_correct": False},
                            {"text": "are being", "is_correct": False},
                        ],
                    },
                    {
                        "question_text": "Complete the analogy — Teacher : Classroom :: Doctor : ______",
                        "points": 10,
                        "options": [
                            {"text": "Patient", "is_correct": False},
                            {"text": "Hospital", "is_correct": True},
                            {"text": "Medicine", "is_correct": False},
                            {"text": "Stethoscope", "is_correct": False},
                        ],
                    },
                ],
            },
        },

        # --- FILIPINO 7 ---
        {
            "subject_id": 1,
            "staff_id": "2026-0002",
            "title": "Mga Kuwentong-Bayan, Alamat, at Pabula ng Pilipinas",
            "classwork_type": "READING",
            "classwork_category": "WRITTEN_WORK",
            "description": "Pangkalahatang pagbasa ukol sa panitikan ng Pilipinas bago dumating ang mga Espanyol.",
            "instructions": "Basahin at unawain ang Alamat ng Bulkang Mayon at ang kuwento ni Si Pagong at Si Matsing.",
            "total_points": None,
            "is_graded": False,
            "due_days": None,
        },
        {
            "subject_id": 1,
            "staff_id": "2026-0002",
            "title": "Gawain 1: Pagsulat ng Sariling Alamat o Kuwentong-Bayan",
            "classwork_type": "ASSIGNMENT",
            "classwork_category": "WRITTEN_WORK",
            "description": "Lumikha ng isang orihinal na alamat na nagpapaliwanag sa pinagmulan ng isang bagay sa inyong komunidad.",
            "instructions": "Gumamit ng wastong gramatika at bantas. Isumite ang iyong akda dito.",
            "total_points": 50,
            "is_graded": True,
            "due_days": 6,
        },
        {
            "subject_id": 1,
            "staff_id": "2026-0002",
            "title": "Filipino 7: Pagsusulit sa Panitikan at Wika",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "description": "Pagsusulit tungkol sa elemento ng alamat at wastong paggamit ng mga pahayag sa pagpapatunay.",
            "instructions": "Piliin ang pinaka-angkop na sagot sa bawat tanong.",
            "total_points": 20,
            "is_graded": True,
            "due_days": 9,
            "quiz_info": {
                "duration_minutes": 20,
                "questions": [
                    {
                        "question_text": "Ano ang tawag sa uri ng panitikan na nagpapaliwanag ng pinagmulan ng mga bagay-bagay sa daigdig?",
                        "points": 10,
                        "options": [
                            {"text": "Pabula", "is_correct": False},
                            {"text": "Alamat", "is_correct": True},
                            {"text": "Epiko", "is_correct": False},
                            {"text": "Parabula", "is_correct": False},
                        ],
                    },
                    {
                        "question_text": "Alin sa mga sumusunod ang pahayag na nagbibigay ng patunay?",
                        "points": 10,
                        "options": [
                            {"text": "Sa aking palagay, maganda ang panahon ngayon.", "is_correct": False},
                            {"text": "Baka sakaling umulan mamayang hapon.", "is_correct": False},
                            {"text": "Ayon sa datos ng PAGASA, may papasok na bagyo bukas.", "is_correct": True},
                            {"text": "Tila mahirap ang pagsusulit.", "is_correct": False},
                        ],
                    },
                ],
            },
        },

        # --- ICT ---
        {
            "subject_id": 20,
            "staff_id": "2026-0007",
            "title": "Computer Hardware Components and Peripherals Overview",
            "classwork_type": "READING",
            "classwork_category": "WRITTEN_WORK",
            "description": "Understanding system unit components: CPU, Motherboard, RAM, Storage drives, and I/O peripherals.",
            "instructions": "Read the study guide and identify the functions of internal computer hardware parts.",
            "total_points": None,
            "is_graded": False,
            "due_days": None,
        },
        {
            "subject_id": 20,
            "staff_id": "2026-0007",
            "title": "Hands-on Activity: PC Hardware Diagnostic and Safety Checklist",
            "classwork_type": "ACTIVITY",
            "classwork_category": "PERFORMANCE_TASK",
            "description": "Complete the Occupational Health and Safety (OHS) procedure checklist for computer servicing.",
            "instructions": "Submit your completed diagnostic worksheet and safety checklist.",
            "total_points": 50,
            "is_graded": True,
            "due_days": 7,
        },

        # --- VALUES EDUCATION ---
        {
            "subject_id": 23,
            "staff_id": "2026-0004",
            "title": "Ang Paggamit ng Isip at Kilos-Loob sa Pagpapasiya",
            "classwork_type": "READING",
            "classwork_category": "WRITTEN_WORK",
            "description": "Pang-unawa sa kalikasan ng tao, ang tungkulin ng isip sa pagtuklas ng katotohanan at kilos-loob sa pagpili ng mabuti.",
            "instructions": "Basahin ang modyul at pagnilayan ang mga sitwasyon ng moral na pagpapasiya.",
            "total_points": None,
            "is_graded": False,
            "due_days": None,
        },
        {
            "subject_id": 23,
            "staff_id": "2026-0004",
            "title": "Reflective Journal: Pagpapaunlad ng Tiwala sa Sarili at Talento",
            "classwork_type": "ASSIGNMENT",
            "classwork_category": "PERFORMANCE_TASK",
            "description": "Sumulat ng personal na pagninilay ukol sa mga sariling kakayahan at kung paano ito gagamitin sa paglilingkod.",
            "instructions": "Isumite ang iyong journal entry na may 3 talata.",
            "total_points": 50,
            "is_graded": True,
            "due_days": 8,
        },

        # --- PHYSICAL EDUCATION ---
        {
            "subject_id": 28,
            "staff_id": "2026-0012",
            "title": "Physical Fitness Components and Assessment Guide",
            "classwork_type": "READING",
            "classwork_category": "WRITTEN_WORK",
            "description": "Overview of Health-Related and Skill-Related Fitness Components and target heart rate calculation.",
            "instructions": "Read the physical fitness guide before conducting your physical assessment test.",
            "total_points": None,
            "is_graded": False,
            "due_days": None,
        },
        {
            "subject_id": 28,
            "staff_id": "2026-0012",
            "title": "Individual Physical Fitness Test Scorecard & Log",
            "classwork_type": "ACTIVITY",
            "classwork_category": "PERFORMANCE_TASK",
            "description": "Record your baseline physical fitness metrics: push-ups, sit-and-reach, 3-minute step test, and BMI.",
            "instructions": "Complete the scorecard with accurate measurements and parent/guardian sign-off.",
            "total_points": 50,
            "is_graded": True,
            "due_days": 9,
        },

        # --- MUSIC ---
        {
            "subject_id": 27,
            "staff_id": "2026-0008",
            "title": "Music of the Lowlands of Luzon: Vocal and Instrumental Forms",
            "classwork_type": "READING",
            "classwork_category": "WRITTEN_WORK",
            "description": "Study of liturgical and devotional music, secular songs (Harana, Balitaw, Kundiman), and Rondalla instruments.",
            "instructions": "Listen to the referenced folk audio tracks and read the stylistic characteristics.",
            "total_points": None,
            "is_graded": False,
            "due_days": None,
        },
        {
            "subject_id": 27,
            "staff_id": "2026-0008",
            "title": "Music Listening Analysis: Traditional Philippine Folk Songs",
            "classwork_type": "ASSIGNMENT",
            "classwork_category": "WRITTEN_WORK",
            "description": "Analyze the tempo, meter, timbre, and mood of 3 designated Luzon lowland folk songs.",
            "instructions": "Fill out the listening analysis sheet and submit your comparative evaluation.",
            "total_points": 40,
            "is_graded": True,
            "due_days": 10,
        },

        # --- ARTS ---
        {
            "subject_id": 24,
            "staff_id": "2026-0009",
            "title": "Arts and Crafts of Luzon (Highlands and Lowlands)",
            "classwork_type": "READING",
            "classwork_category": "WRITTEN_WORK",
            "description": "Exploration of indigenous textile weaving, pottery (Burnay), and folk architecture across Luzon provinces.",
            "instructions": "Study the motifs, color palettes, and cultural symbolism of Northern Luzon craftsmanship.",
            "total_points": None,
            "is_graded": False,
            "due_days": None,
        },
        {
            "subject_id": 24,
            "staff_id": "2026-0009",
            "title": "Creative Art Project: Indigenous Pattern Design",
            "classwork_type": "ACTIVITY",
            "classwork_category": "PERFORMANCE_TASK",
            "description": "Create an original artwork incorporating Cordillera or Inabel textile geometric patterns.",
            "instructions": "Use coloring materials or digital illustration tools and upload your artwork photo or digital render.",
            "total_points": 60,
            "is_graded": True,
            "due_days": 11,
        },

        # --- HEALTH ---
        {
            "subject_id": 26,
            "staff_id": "2026-0010",
            "title": "Holistic Health and Growth During Adolescence",
            "classwork_type": "READING",
            "classwork_category": "WRITTEN_WORK",
            "description": "Understanding physical, mental, emotional, social, and moral-spiritual dimensions of adolescent development.",
            "instructions": "Read chapter 1 on holistic health management and health appraisal procedures.",
            "total_points": None,
            "is_graded": False,
            "due_days": None,
        },
        {
            "subject_id": 26,
            "staff_id": "2026-0010",
            "title": "Personal Health Plan and Nutritional Habit Tracker",
            "classwork_type": "ASSIGNMENT",
            "classwork_category": "PERFORMANCE_TASK",
            "description": "Formulate a 7-day personal health and dietary improvement plan based on Pinggang Pinoy guidelines.",
            "instructions": "Complete the 7-day log table and submit your reflection on healthy lifestyle goals.",
            "total_points": 40,
            "is_graded": True,
            "due_days": 12,
        },
    ]

    for item in classworks_data:
        # Check if classwork with exact title and subject already exists
        cw = (
            db.query(Classwork)
            .filter(
                Classwork.subject_id == item["subject_id"],
                Classwork.title == item["title"],
            )
            .first()
        )
        if not cw:
            cw = Classwork(
                title=item["title"],
                description=item["description"],
                instructions=item["instructions"],
                classwork_type=item["classwork_type"],
                classwork_category=item.get("classwork_category", "WRITTEN_WORK"),
                activity_mode="ONLINE",
                is_graded=item["is_graded"],
                total_points=Decimal(str(item["total_points"])) if item["total_points"] is not None else None,
                is_locked=False,
                is_published=True,
                show_scores=True,
                is_archived=False,
                subject_id=item["subject_id"],
                created_by_staff_id=item["staff_id"],
            )
            db.add(cw)
            db.commit()
            db.refresh(cw)
            print(f"Created Classwork ID {cw.classwork_id}: '{cw.title}' ({cw.classwork_type})")
        else:
            cw.is_published = True
            cw.is_archived = False
            cw.description = item["description"]
            cw.instructions = item["instructions"]
            cw.created_by_staff_id = item["staff_id"]
            db.commit()
            print(f"Existing Classwork ID {cw.classwork_id}: '{cw.title}'")

        # Check / Create Quiz details if applicable
        if item["classwork_type"] == "QUIZ" and "quiz_info" in item:
            quiz_info = item["quiz_info"]
            quiz = db.query(Quiz).filter(Quiz.classwork_id == cw.classwork_id).first()
            if not quiz:
                quiz = Quiz(
                    classwork_id=cw.classwork_id,
                    total_items=len(quiz_info["questions"]),
                    duration_minutes=quiz_info.get("duration_minutes", 30),
                    status="PUBLISHED",
                )
                db.add(quiz)
                db.commit()
                db.refresh(quiz)

                for idx, q_data in enumerate(quiz_info["questions"], start=1):
                    q = Question(
                        question_text=q_data["question_text"],
                        question_type="MULTIPLE_CHOICE",
                        points=Decimal(str(q_data["points"])),
                        difficulty_level="MEDIUM",
                    )
                    db.add(q)
                    db.commit()
                    db.refresh(q)

                    qq = QuizQuestion(
                        quiz_id=quiz.quiz_id,
                        question_id=q.question_id,
                        display_order=idx,
                    )
                    db.add(qq)

                    for opt_idx, opt_data in enumerate(q_data["options"], start=1):
                        opt = QuestionOption(
                            question_id=q.question_id,
                            option_text=opt_data["text"],
                            is_correct=opt_data["is_correct"],
                            option_order=opt_idx,
                        )
                        db.add(opt)
                    db.commit()
                print(f"  -> Configured Quiz ID {quiz.quiz_id} with {len(quiz_info['questions'])} questions")

        # Ensure ClassworkAssignment exists for Class 6 (Galileo)
        due_date = now + timedelta(days=item["due_days"]) if item.get("due_days") else None
        assignment = (
            db.query(ClassworkAssignment)
            .filter(
                ClassworkAssignment.classwork_id == cw.classwork_id,
                ClassworkAssignment.class_id == galileo_class.class_id,
            )
            .first()
        )
        if not assignment:
            assignment = ClassworkAssignment(
                classwork_id=cw.classwork_id,
                class_id=galileo_class.class_id,
                academic_period_id=1,
                assigned_by_staff_id=item["staff_id"],
                publish_date=now,
                due_date=due_date,
                is_published=True,
                is_locked=False,
                allow_late_submissions=True,
                max_attempts=3 if item["classwork_type"] == "QUIZ" else 1,
            )
            db.add(assignment)
            db.commit()
            db.refresh(assignment)
            print(f"  -> Assigned to Class 6 (Assignment ID {assignment.classwork_assignment_id}, Due: {due_date})")
        else:
            assignment.is_published = True
            assignment.is_locked = False
            assignment.academic_period_id = 1
            assignment.assigned_by_staff_id = item["staff_id"]
            if due_date and not assignment.due_date:
                assignment.due_date = due_date
            db.commit()
            print(f"  -> Updated Assignment ID {assignment.classwork_assignment_id} for Class 6")

    print("\nSUCCESS: All subjects and classworks for Manuel Garcia have been successfully populated!")
    db.close()


if __name__ == "__main__":
    populate_manuel_subjects_and_classworks()
