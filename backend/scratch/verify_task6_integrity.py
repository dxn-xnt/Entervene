"""Verification script for Task 6 Class-Wide Mappings & Integrity Audit."""

import os
import sys
from collections import defaultdict
from decimal import Decimal

sys.path.insert(0, os.path.abspath("backend"))
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.models.quiz.QuizAnswer import QuizAnswer


def main():
    demo_env = dotenv_values("backend/.env.demo")
    engine = create_engine(demo_env.get("DATABASE_URL"))

    with Session(engine) as db:
        print("=" * 80)
        print("TASK 6 INTEGRITY & CURRICULUM AUDIT REPORT")
        print("=" * 80)

        # 1. Competencies & Lessons
        print("\n--- 1. ACTIVE COMPETENCIES ---")
        comps = db.query(Competency).order_by(Competency.competency_id).all()
        for c in comps:
            print(f"ID {c.competency_id}: [{c.competency_code}] {c.statement[:70]}... (Subject: {c.subject_id}, Period: {c.academic_period_id})")

        print("\n--- 2. ACTIVE LESSONS ---")
        lessons = db.query(Lesson).order_by(Lesson.lesson_id).all()
        for l in lessons:
            print(f"ID {l.lesson_id}: {l.title} (Competency ID: {l.competency_id}, Published: {l.is_published}, Draft: {l.is_draft})")

        print("\n--- 3. CLASSWORK LESSON MAPPINGS ---")
        cls = db.query(ClassworkLesson).order_by(ClassworkLesson.classwork_id, ClassworkLesson.lesson_id).all()
        for cl in cls:
            cw = db.get(Classwork, cl.classwork_id)
            ls = db.get(Lesson, cl.lesson_id)
            print(f"CW {cw.classwork_id} ({cw.title}) -> Lesson {ls.lesson_id} ({ls.title})")

        print("\n--- 4. CLASSWORK COVERAGE MAPPINGS (MANUAL) ---")
        covs = db.query(ClassworkCoverage).order_by(ClassworkCoverage.classwork_id).all()
        for cov in covs:
            cw = db.get(Classwork, cov.classwork_id)
            ls = db.get(Lesson, cov.lesson_id) if cov.lesson_id else None
            cp = db.get(Competency, cov.competency_id) if cov.competency_id else None
            print(f"Coverage {cov.coverage_id}: CW {cov.classwork_id} ({cw.title}) -> Lesson {cov.lesson_id} ({ls.title if ls else 'None'}), Comp {cov.competency_id} ({cp.competency_code if cp else 'None'}) [valid_from: {cov.valid_from.isoformat()}]")

        # 2. Frozen Historical Record Checks
        print("\n--- 5. HISTORICAL INTEGRITY CHECKS ---")
        total_preds = db.query(DevelopmentCurrentTermPrediction).count()
        total_invs = db.query(Intervention).count()
        total_subs = db.query(StudentSubmission).count()
        print(f"Total Predictions: {total_preds} (Expected: 45)")
        print(f"Total Interventions: {total_invs} (Expected: 4)")
        print(f"Total Submissions: {total_subs}")

        # Check Jordan Pred 44
        p44 = db.get(DevelopmentCurrentTermPrediction, 44)
        print(f"Jordan Pred #44: grade={p44.predicted_period_grade}, tier={p44.intervention_level}, revision={p44.revision}, cutoff={p44.evidence_snapshot.get('generation_cutoff_at')}")

        # Check Morgan Pred 45
        p45 = db.get(DevelopmentCurrentTermPrediction, 45)
        print(f"Morgan Pred #45: grade={p45.predicted_period_grade}, tier={p45.intervention_level}, revision={p45.revision}, cutoff={p45.evidence_snapshot.get('generation_cutoff_at')}")

        # Check Drew Inv 3 & Morgan Inv 5
        i3 = db.get(Intervention, 3)
        i5 = db.get(Intervention, 5)
        print(f"Drew Inv #3: status={i3.status}, pred_id={i3.source_prediction_id}, targets={len(i3.diagnosis_snapshot.get('candidate_targets', [])) if i3.diagnosis_snapshot else 0}")
        print(f"Morgan Inv #5: status={i5.status}, pred_id={i5.source_prediction_id}, targets={len(i5.diagnosis_snapshot.get('candidate_targets', [])) if i5.diagnosis_snapshot else 0}")

        # 3. Class-wide Student Matrix
        print("\n--- 6. CLASS-WIDE VERIFICATION MATRIX (ALL 11 STUDENTS) ---")
        students = db.execute(text("""
            SELECT s.student_id, s.student_lrn, s.first_name, s.last_name
            FROM student s
            JOIN student_class sc ON s.student_id = sc.student_id
            WHERE sc.class_id = 1
            ORDER BY s.student_lrn
        """)).fetchall()

        for st in students:
            pred = db.query(DevelopmentCurrentTermPrediction).filter_by(
                student_id=st.student_id
            ).order_by(DevelopmentCurrentTermPrediction.prediction_id.desc()).first()

            # Submissions & mapped classworks
            subs = db.execute(text("""
                SELECT ss.submission_id, ss.grade, cw.classwork_id, cw.title, cw.activity_mode, cw.classwork_category
                FROM student_submission ss
                JOIN classwork_assignment ca ON ss.classwork_assignment_id = ca.classwork_assignment_id
                JOIN classwork cw ON ca.classwork_id = cw.classwork_id
                WHERE ss.student_id = :sid AND ss.status = 'graded'
                ORDER BY cw.classwork_id
            """), {"sid": st.student_id}).fetchall()

            mapped_lessons = set()
            manual_cov_comps = set()
            for sub in subs:
                for cl in db.query(ClassworkLesson).filter_by(classwork_id=sub.classwork_id).all():
                    mapped_lessons.add(cl.lesson_id)
                for cov in db.query(ClassworkCoverage).filter_by(classwork_id=sub.classwork_id, valid_until=None).all():
                    if cov.competency_id:
                        comp = db.get(Competency, cov.competency_id)
                        manual_cov_comps.add(comp.competency_code)

            # Scored quiz item evidence
            quiz_ev = db.execute(text("""
                SELECT qa.answer_id, qa.points_awarded, q.points, c.competency_code
                FROM quiz_answer qa
                JOIN quiz_question qq ON qa.quiz_question_id = qq.quiz_question_id
                JOIN question q ON qq.question_id = q.question_id
                JOIN lesson l ON q.lesson_id = l.lesson_id
                JOIN competency c ON l.competency_id = c.competency_id
                JOIN student_submission ss ON qa.submission_id = ss.submission_id
                WHERE ss.student_id = :sid
            """), {"sid": st.student_id}).fetchall()

            scored_items_summary = [f"{q.competency_code}: {q.points_awarded}/{q.points}" for q in quiz_ev]

            readiness_lvl = pred.evidence_snapshot.get("readiness", {}).get("level") if pred else "NONE"
            pred_info = f"Pred #{pred.prediction_id}: {pred.predicted_period_grade} ({pred.intervention_level})" if pred else "No prediction"

            print(f"\nStudent: {st.first_name} {st.last_name} (LRN: {st.student_lrn})")
            print(f"  Readiness Level: {readiness_lvl}")
            print(f"  Latest Prediction: {pred_info}")
            print(f"  Graded Submissions: {len(subs)}")
            print(f"  Available Mapped Lessons: {sorted(list(mapped_lessons))}")
            print(f"  Eligible Manual Coverage Competencies: {sorted(list(manual_cov_comps))}")
            print(f"  Scored Item Evidence Count: {len(quiz_ev)} -> {scored_items_summary if scored_items_summary else 'None'}")
            if len(quiz_ev) == 0:
                print(f"  Remaining for Scored Competency Diagnosis: Requires question-level scored quiz/remediation items in weakest component.")
            else:
                print(f"  Remaining for Scored Competency Diagnosis: Has active item-level evidence.")


if __name__ == "__main__":
    main()
