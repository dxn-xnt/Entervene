import sys, os
sys.path.insert(0, os.path.abspath("."))
from app.db.Session import engine
from sqlalchemy import text

with engine.connect() as conn:
    print("=== UNIFIED GRADING STANDARDS IN DATABASE ===")
    rows = conn.execute(text("""
        SELECT 
            gt.grading_template_id,
            gt.template_name,
            sg.name as group_name,
            sg.passing_threshold,
            gt.status,
            COUNT(s.subject_id) as subject_count
        FROM grading_template gt
        LEFT JOIN subject_groups sg ON gt.subject_group_id = sg.subject_group_id
        LEFT JOIN subject s ON (s.default_grading_template = CAST(gt.grading_template_id AS VARCHAR) OR s.default_grading_template = gt.template_name)
        GROUP BY gt.grading_template_id, gt.template_name, sg.name, sg.passing_threshold, gt.status
        ORDER BY sg.name, gt.template_name
    """)).mappings().all()
    for r in rows:
        comps = conn.execute(text("SELECT component_name, weight FROM grading_template_component WHERE grading_template_id = :tid ORDER BY display_order"), {"tid": r["grading_template_id"]}).fetchall()
        comp_summary = " · ".join([f"{c[0]}: {c[1]}%" for c in comps])
        print(f"[{r['grading_template_id']:2d}] {r['template_name']:32s} | Group: {r['group_name'] or 'None':12s} | Pass: {r['passing_threshold']}% | Subjects: {r['subject_count']:2d} | Weights: {comp_summary}")

    print("\n=== CHECK UNMAPPED SUBJECTS ===")
    unmapped = conn.execute(text("""
        SELECT count(*) FROM subject WHERE default_grading_template IS NULL OR default_grading_template NOT IN (SELECT CAST(grading_template_id AS VARCHAR) FROM grading_template)
    """)).scalar()
    print("Unmapped subjects count:", unmapped)

    print("\n=== VERIFY ALL 40 SUBJECTS RESOLUTION ===")
    from app.services.student_record.StudentRecordService import resolve_subject_grading_weights
    from sqlalchemy.orm import Session
    from app.models.academic.Subject import Subject
    with Session(engine) as session:
        for s in session.query(Subject).order_by(Subject.academic_level_id, Subject.subject_name).all():
            w = resolve_subject_grading_weights(session, s.subject_id)
            pass_th = float(s.subject_group_rel.passing_threshold) if s.subject_group_rel else 0.0
            print(f"Grade {s.academic_level_id} | {s.subject_name:30s} | Code: {s.subject_codename or 'None':8s} | Group: {s.subject_group_rel.name:12s} | Pass: {pass_th}% | WW: {w.ww_weight*100:2.0f}% PT: {w.pt_weight*100:2.0f}% QA: {w.qa_weight*100:2.0f}% (Tpl ID: {w.template_id})")
