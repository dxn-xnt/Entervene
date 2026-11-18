\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  src intervention%ROWTYPE;
  sid uuid := gen_random_uuid();
  pid integer;
  iid integer;
  cols text;
  r record;
  ns integer;
  diagnosis text;
BEGIN
  SELECT * INTO STRICT src FROM intervention WHERE intervention_id = 1;
  IF EXISTS (SELECT 1 FROM student WHERE student_lrn = '399999999012') THEN
    RAISE EXCEPTION 'Test LRN already exists; no duplicate created';
  END IF;
  INSERT INTO student(student_id,student_lrn,first_name,middle_name,last_name,gender,academic_level_id,prior_gwa)
  SELECT sid,'399999999012','Gabriel Test','Emmanuel','Aquino 12 Test',gender,academic_level_id,prior_gwa
  FROM student WHERE student_id=src.student_id;
  INSERT INTO student_class(student_id,class_id,academic_year_id,enrollment_status)
  SELECT sid,c.class_id,c.academic_year_id,'enrolled' FROM class c WHERE c.class_id=src.class_id;
  diagnosis := replace(src.diagnosis_snapshot::text,src.student_id::text,sid::text);
  SELECT string_agg(quote_ident(column_name),',' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns WHERE table_schema='public' AND table_name='student_submission' AND column_name <> 'submission_id';
  FOR r IN SELECT s.* FROM student_submission s JOIN classwork_assignment ca USING(classwork_assignment_id)
    WHERE s.student_id=src.student_id AND ca.class_id=src.class_id
  LOOP
    EXECUTE format('INSERT INTO student_submission(%s) SELECT %s FROM json_populate_record(NULL::student_submission,$1) RETURNING submission_id',cols,cols)
      INTO ns USING (to_jsonb(r)||jsonb_build_object('student_id',sid))::json;
    INSERT INTO quiz_answer(quiz_question_id,submission_id,answer_text,is_correct,points_awarded)
    SELECT quiz_question_id,ns,answer_text,is_correct,points_awarded FROM quiz_answer WHERE submission_id=r.submission_id;
    diagnosis := replace(diagnosis,'"submission_id": '||r.submission_id||',','"submission_id": '||ns||',');
  END LOOP;
  INSERT INTO student_assessment_score(assessment_id,student_id,raw_score,score_status,encoded_at,entered_by_staff_id)
  SELECT assessment_id,sid,raw_score,score_status,encoded_at,entered_by_staff_id FROM student_assessment_score WHERE student_id=src.student_id;
  INSERT INTO development_current_term_prediction(student_id,class_id,subject_id,source_period_id,target_period_id,model_version_id,revision,predicted_period_grade,intervention_level,intervention_basis,risk_score,evidence_snapshot)
  SELECT sid,class_id,subject_id,source_period_id,target_period_id,model_version_id,1,predicted_period_grade,intervention_level,intervention_basis,NULL,evidence_snapshot
  FROM development_current_term_prediction WHERE prediction_id=src.source_prediction_id RETURNING prediction_id INTO pid;
  INSERT INTO intervention(student_id,class_id,subject_id,academic_period_id,source_prediction_id,status,diagnosis_snapshot)
  VALUES(sid,src.class_id,src.subject_id,src.academic_period_id,pid,'CANDIDATE',
    (diagnosis::jsonb||jsonb_build_object('source_prediction_id',pid))::json) RETURNING intervention_id INTO iid;
  RAISE NOTICE 'Created test candidate %, student %, prediction %',iid,sid,pid;
END $$;
SELECT s.first_name,s.last_name,s.student_lrn,i.intervention_id,i.status,c.section_name,p.period_name,y.year_label,
 i.remediation_plan IS NULL AS unconfigured,i.activated_at IS NULL AS not_activated
FROM intervention i JOIN student s ON s.student_id=i.student_id JOIN class c ON c.class_id=i.class_id
JOIN academic_period p ON p.academic_period_id=i.academic_period_id JOIN academic_year y ON y.academic_year_id=p.academic_year_id
WHERE s.student_lrn='399999999012';
COMMIT;
