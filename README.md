# Entervene
An AI-Enhanced Learning Management System for Student Risk Management and Academic Success

```
Entervene
├─ backend
│  ├─ alembic.ini
│  ├─ app
│  │  ├─ api
│  │  │  ├─ v1
│  │  │  │  ├─ routes
│  │  │  │  │  ├─ Analytics.py
│  │  │  │  │  ├─ Auth.py
│  │  │  │  │  ├─ Classes.py
│  │  │  │  │  ├─ Classworks.py
│  │  │  │  │  ├─ GradingTemplates.py
│  │  │  │  │  ├─ Lessons.py
│  │  │  │  │  ├─ Predictions.py
│  │  │  │  │  ├─ Quizzes.py
│  │  │  │  │  ├─ StudentRecords.py
│  │  │  │  │  ├─ Students.py
│  │  │  │  │  ├─ SubjectOfferings.py
│  │  │  │  │  ├─ Subjects.py
│  │  │  │  │  ├─ Submissions.py
│  │  │  │  │  ├─ Suggestions.py
│  │  │  │  │  ├─ Users.py
│  │  │  │  │  └─ __init__.py
│  │  │  │  └─ __init__.py
│  │  │  └─ __init__.py
│  │  ├─ core
│  │  │  ├─ Config.py
│  │  │  ├─ Csrf.py
│  │  │  ├─ Dependencies.py
│  │  │  ├─ FileUpload.py
│  │  │  ├─ Security.py
│  │  │  ├─ StaffId.py
│  │  │  └─ __init__.py
│  │  ├─ db
│  │  │  ├─ Base.py
│  │  │  ├─ Session.py
│  │  │  └─ __init__.py
│  │  ├─ main.py
│  │  ├─ ml
│  │  │  ├─ DatasetPackValidator.py
│  │  │  ├─ RegisterModelVersion.py
│  │  │  ├─ SavePrediction.py
│  │  │  ├─ ScorePrediction.py
│  │  │  ├─ Train.py
│  │  │  └─ __init__.py
│  │  ├─ models
│  │  │  ├─ academic
│  │  │  │  ├─ AcademicLevel.py
│  │  │  │  ├─ AcademicPeriod.py
│  │  │  │  ├─ AcademicYear.py
│  │  │  │  ├─ AssessmentItem.py
│  │  │  │  ├─ Class_.py
│  │  │  │  ├─ GradingTemplate.py
│  │  │  │  ├─ GradingTemplateComponent.py
│  │  │  │  ├─ Lesson.py
│  │  │  │  ├─ LessonAssignment.py
│  │  │  │  ├─ LessonAttachment.py
│  │  │  │  ├─ StudentAssessmentScore.py
│  │  │  │  ├─ StudentCLass.py
│  │  │  │  ├─ StudentPeriodGrade.py
│  │  │  │  ├─ Subject.py
│  │  │  │  ├─ SubjectLoad.py
│  │  │  │  ├─ SubjectOffering.py
│  │  │  │  └─ __init__.py
│  │  │  ├─ ai
│  │  │  │  ├─ AIModelVersion.py
│  │  │  │  ├─ AIPrediction.py
│  │  │  │  ├─ AIPredictionFeature.py
│  │  │  │  ├─ PredictionOutcome.py
│  │  │  │  ├─ RiskThreshold.py
│  │  │  │  ├─ TeacherRiskReview.py
│  │  │  │  └─ __init__.py
│  │  │  ├─ attendance
│  │  │  │  └─ __init__.py
│  │  │  ├─ auth
│  │  │  │  ├─ InvitationToken.py
│  │  │  │  ├─ Role.py
│  │  │  │  ├─ UserAccount.py
│  │  │  │  ├─ UserLoginLog.py
│  │  │  │  ├─ UserRoles.py
│  │  │  │  └─ __init__.py
│  │  │  ├─ classwork
│  │  │  │  ├─ Classwork.py
│  │  │  │  ├─ ClassworkAssignment.py
│  │  │  │  ├─ ClassworkAttachment.py
│  │  │  │  ├─ ClassworkLesson.py
│  │  │  │  └─ __init__.py
│  │  │  ├─ interventions
│  │  │  │  └─ __init__.py
│  │  │  ├─ notifications
│  │  │  │  └─ __init__.py
│  │  │  ├─ people
│  │  │  │  ├─ AcademicStaff.py
│  │  │  │  ├─ Student.py
│  │  │  │  └─ __init__.py
│  │  │  ├─ quiz
│  │  │  │  ├─ Question.py
│  │  │  │  ├─ QuestionOption.py
│  │  │  │  ├─ Quiz.py
│  │  │  │  ├─ QuizAnswer.py
│  │  │  │  ├─ QuizQuestion.py
│  │  │  │  ├─ QuizSetting.py
│  │  │  │  └─ __init__.py
│  │  │  ├─ submissions
│  │  │  │  ├─ StudentSubmission.py
│  │  │  │  ├─ SubmissionAttachment.py
│  │  │  │  └─ __init__.py
│  │  │  ├─ suggestion
│  │  │  │  ├─ StudentSuggestion.py
│  │  │  │  ├─ SuggestionClasswork.py
│  │  │  │  └─ __init__.py
│  │  │  └─ __init__.py
│  │  ├─ schemas
│  │  │  ├─ Auth.py
│  │  │  ├─ Class.py
│  │  │  ├─ Classwork.py
│  │  │  ├─ GradingTemplate.py
│  │  │  ├─ Lesson.py
│  │  │  ├─ Prediction.py
│  │  │  ├─ Quiz.py
│  │  │  ├─ Student.py
│  │  │  ├─ StudentRecord.py
│  │  │  ├─ Subject.py
│  │  │  ├─ SubjectOffering.py
│  │  │  ├─ Submission.py
│  │  │  ├─ Suggestion.py
│  │  │  ├─ User.py
│  │  │  └─ __init__.py
│  │  └─ services
│  │     ├─ AcademicPeriodService.py
│  │     ├─ classes
│  │     │  ├─ ClassImportService.py
│  │     │  ├─ ClassQueryService.py
│  │     │  ├─ ClassService.py
│  │     │  ├─ ClassShared.py
│  │     │  ├─ ClassStudentService.py
│  │     │  └─ __init__.py
│  │     ├─ classwork
│  │     │  ├─ ClassworkAccessService.py
│  │     │  ├─ ClassworkResponseService.py
│  │     │  ├─ ClassworkService.py
│  │     │  ├─ ClassworkShared.py
│  │     │  └─ __init__.py
│  │     ├─ grading_templates
│  │     │  ├─ GradingTemplateQueryService.py
│  │     │  ├─ GradingTemplateService.py
│  │     │  ├─ GradingTemplateShared.py
│  │     │  └─ __init__.py
│  │     ├─ lesson
│  │     │  ├─ LessonFileService.py
│  │     │  ├─ LessonResponseService.py
│  │     │  ├─ LessonService.py
│  │     │  ├─ LessonShared.py
│  │     │  └─ __init__.py
│  │     ├─ MailService.py
│  │     ├─ prediction
│  │     │  ├─ ModelPerformanceService.py
│  │     │  ├─ ModelScoringService.py
│  │     │  ├─ ModelVersionService.py
│  │     │  ├─ PredictionExplanationService.py
│  │     │  ├─ PredictionFeatureBuilderService.py
│  │     │  ├─ PredictionOutcomeService.py
│  │     │  ├─ PredictionPersistenceService.py
│  │     │  ├─ PredictionReadService.py
│  │     │  ├─ RiskEngine.py
│  │     │  ├─ TeacherRiskReviewService.py
│  │     │  └─ __init__.py
│  │     ├─ quiz
│  │     │  ├─ QuizAnalysisService.py
│  │     │  ├─ QuizAttemptService.py
│  │     │  ├─ QuizBuilderService.py
│  │     │  ├─ QuizImportService.py
│  │     │  └─ __init__.py
│  │     ├─ student_record
│  │     │  ├─ StudentRecordService.py
│  │     │  └─ __init__.py
│  │     ├─ subjects
│  │     │  ├─ SubjectImportService.py
│  │     │  ├─ SubjectQueryService.py
│  │     │  ├─ SubjectService.py
│  │     │  ├─ SubjectShared.py
│  │     │  └─ __init__.py
│  │     ├─ subject_offerings
│  │     │  ├─ SubjectOfferingImportService.py
│  │     │  ├─ SubjectOfferingQueryService.py
│  │     │  ├─ SubjectOfferingService.py
│  │     │  ├─ SubjectOfferingShared.py
│  │     │  └─ __init__.py
│  │     ├─ submission
│  │     │  ├─ SubmissionService.py
│  │     │  └─ __init__.py
│  │     ├─ suggestion
│  │     │  ├─ RecommendationService.py
│  │     │  ├─ SuggestionService.py
│  │     │  └─ __init__.py
│  │     ├─ users
│  │     │  ├─ UserAccountService.py
│  │     │  ├─ UserImportService.py
│  │     │  ├─ UserInvitationService.py
│  │     │  ├─ UserQueryService.py
│  │     │  ├─ UserShared.py
│  │     │  └─ __init__.py
│  │     └─ __init__.py
│  ├─ database_schema.txt
│  ├─ migrations
│  │  ├─ env.py
│  │  ├─ README
│  │  ├─ script.py.mako
│  │  └─ versions
│  │     ├─ 20260603_security_integrity.py
│  │     ├─ 20260604_add_lesson_is_archived.py
│  │     ├─ 20260606_class_adviser_academic_year_integrity.py
│  │     ├─ 20260606_student_class_academic_year_integrity.py
│  │     ├─ 20260617_add_classwork_is_archived.py
│  │     ├─ 20260621_add_ml_prediction_foundation.py
│  │     ├─ 20260621_reading_classwork_type.py
│  │     ├─ 20260624_add_quiz_mvp_models.py
│  │     ├─ 20260625_add_student_dob.py
│  │     ├─ 20260626_add_suggestion_draft_recommendation_states.py
│  │     ├─ 20260626_add_suggestion_mvp_models.py
│  │     ├─ 20260630_active_quarter_to_term.py
│  │     ├─ 20260630_add_quiz_summary_release_settings.py
│  │     ├─ 20260701_add_allow_late_submissions.py
│  │     ├─ 20260701_merge_quiz_summary_and_active_term_heads.py
│  │     ├─ 20260702_add_general_subject_offering_pathway.py
│  │     ├─ 20260702_add_grading_template_tables.py
│  │     ├─ 20260702_add_subject_catalog_fields.py
│  │     ├─ 20260702_add_subject_offering_table.py
│  │     ├─ 20260703_add_prediction_outcome_evaluation_fields.py
│  │     ├─ 20260703_add_student_period_grade_finalization.py
│  │     ├─ 20260703_update_teacher_risk_review_decisions.py
│  │     └─ 3379e1da9ceb_add_invitation_token_table.py
│  ├─ package-lock.json
│  ├─ requirements.txt
│  ├─ tests
│  │  ├─ conftest.py
│  │  ├─ test_academic_periods.py
│  │  ├─ test_classes_phase_one.py
│  │  ├─ test_classwork_submission_authorization.py
│  │  ├─ test_class_adviser_integrity.py
│  │  ├─ test_class_batch_create.py
│  │  ├─ test_class_detail.py
│  │  ├─ test_class_import_validation.py
│  │  ├─ test_class_list.py
│  │  ├─ test_config.py
│  │  ├─ test_csrf.py
│  │  ├─ test_dataset_pack_validator.py
│  │  ├─ test_grading_template_admin_api.py
│  │  ├─ test_lesson_authorization_lifecycle.py
│  │  ├─ test_ml_train.py
│  │  ├─ test_model_integrity.py
│  │  ├─ test_model_performance_summary.py
│  │  ├─ test_model_scoring_service.py
│  │  ├─ test_prediction_detail_explanations.py
│  │  ├─ test_prediction_feature_builder_service.py
│  │  ├─ test_prediction_outcome_grade_finalization.py
│  │  ├─ test_prediction_outcome_service.py
│  │  ├─ test_prediction_persistence_service.py
│  │  ├─ test_prediction_read_endpoints.py
│  │  ├─ test_prediction_routes.py
│  │  ├─ test_quiz_analysis_api.py
│  │  ├─ test_quiz_attempt_api.py
│  │  ├─ test_quiz_builder_api.py
│  │  ├─ test_quiz_import_api.py
│  │  ├─ test_quiz_model_integrity.py
│  │  ├─ test_register_model_version.py
│  │  ├─ test_risk_engine.py
│  │  ├─ test_security.py
│  │  ├─ test_student_class_integrity.py
│  │  ├─ test_student_class_summary.py
│  │  ├─ test_student_period_grade_finalization.py
│  │  ├─ test_student_record_api.py
│  │  ├─ test_subject_admin_api.py
│  │  ├─ test_subject_import_api.py
│  │  ├─ test_subject_offering_admin_api.py
│  │  ├─ test_subject_offering_import_api.py
│  │  ├─ test_suggestion_api.py
│  │  ├─ test_suggestion_model_integrity.py
│  │  ├─ test_teacher_risk_review.py
│  │  ├─ test_user_list.py
│  │  ├─ test_user_manual_create.py
│  │  └─ test_user_student_import.py
│  └─ uploads
│     ├─ classworks
│     │  ├─ 781b2276485e4898ac98ee6d5c1f73a1.pdf
│     │  └─ e635b0cf29064620b6aef7221d23cb7d.pdf
│     └─ submissions
│        ├─ d8db63647bd9445ea5d352faf0f2d6b9.pdf
│        └─ ee368e9e1e0944dba2ec91574af6bf24.pdf
├─ docs
│  ├─ CODEX_HANDOFF.md
│  └─ ML_HANDOFF.md
├─ fix.js
├─ frontend
│  ├─ components.json
│  ├─ eslint.config.js
│  ├─ index.html
│  ├─ package-lock.json
│  ├─ package.json
│  ├─ public
│  │  ├─ favicon.svg
│  │  └─ icons.svg
│  ├─ README.md
│  ├─ routes
│  │  └─ index.ts
│  ├─ src
│  │  ├─ App.css
│  │  ├─ App.tsx
│  │  ├─ assets
│  │  │  ├─ hero.png
│  │  │  ├─ react.svg
│  │  │  └─ vite.svg
│  │  ├─ components
│  │  │  ├─ admin
│  │  │  │  ├─ AddUserModal.tsx
│  │  │  │  └─ classes
│  │  │  │     ├─ assignment
│  │  │  │     │  ├─ AssignEvenlyConfirmationModal.tsx
│  │  │  │     │  ├─ assignmentDistribution.ts
│  │  │  │     │  ├─ AssignmentStudentRow.tsx
│  │  │  │     │  ├─ AssignmentToolbar.tsx
│  │  │  │     │  ├─ AvailableStudentsPanel.tsx
│  │  │  │     │  ├─ GenderStudentTable.tsx
│  │  │  │     │  ├─ SectionAssignmentCard.tsx
│  │  │  │     │  ├─ SectionDetailsModal.tsx
│  │  │  │     │  ├─ StudentAssignmentWorkspace.tsx
│  │  │  │     │  └─ studentSorting.ts
│  │  │  │     ├─ ClassCard.tsx
│  │  │  │     ├─ fields
│  │  │  │     │  ├─ Field.tsx
│  │  │  │     │  └─ SelectField.tsx
│  │  │  │     ├─ modals
│  │  │  │     │  ├─ AddClassMethodSelection.tsx
│  │  │  │     │  ├─ AddClassModal.tsx
│  │  │  │     │  ├─ ArchiveClassModal.tsx
│  │  │  │     │  ├─ EditClassModal.tsx
│  │  │  │     │  ├─ EditStudentListModal.tsx
│  │  │  │     │  ├─ ImportClassWizard.tsx
│  │  │  │     │  ├─ ManualClassWizard.tsx
│  │  │  │     │  └─ ModalShell.tsx
│  │  │  │     ├─ StudentTransfer.tsx
│  │  │  │     ├─ SummaryCard.tsx
│  │  │  │     └─ utils.ts
│  │  │  ├─ app-content.tsx
│  │  │  ├─ app-sidebar.tsx
│  │  │  ├─ attachment-display.tsx
│  │  │  ├─ chart-area-interactive.tsx
│  │  │  ├─ classwork-cards.tsx
│  │  │  ├─ classwork-item.tsx
│  │  │  ├─ data-table.tsx
│  │  │  ├─ item-line
│  │  │  │  ├─ class.tsx
│  │  │  │  └─ subject.tsx
│  │  │  ├─ lesson-form.tsx
│  │  │  ├─ lesson-modal.tsx
│  │  │  ├─ nav-documents.tsx
│  │  │  ├─ nav-main.tsx
│  │  │  ├─ nav-secondary.tsx
│  │  │  ├─ nav-user.tsx
│  │  │  ├─ navigation-progress.tsx
│  │  │  ├─ notification-card.tsx
│  │  │  ├─ overview-cards.tsx
│  │  │  ├─ pdf-viewer.tsx
│  │  │  ├─ protected-route.tsx
│  │  │  ├─ retroui
│  │  │  │  ├─ Accordion.tsx
│  │  │  │  ├─ Alert.tsx
│  │  │  │  ├─ Avatar.tsx
│  │  │  │  ├─ Badge.tsx
│  │  │  │  ├─ Breadcrumb.tsx
│  │  │  │  ├─ Button.tsx
│  │  │  │  ├─ Calendar.tsx
│  │  │  │  ├─ Card.tsx
│  │  │  │  ├─ Carousel.tsx
│  │  │  │  ├─ Checkbox.tsx
│  │  │  │  ├─ ConfirmAlertDialog.tsx
│  │  │  │  ├─ ContextMenu.tsx
│  │  │  │  ├─ Dialog.tsx
│  │  │  │  ├─ Empty.tsx
│  │  │  │  ├─ Input.tsx
│  │  │  │  ├─ Label.tsx
│  │  │  │  ├─ Loader.tsx
│  │  │  │  ├─ Progress.tsx
│  │  │  │  ├─ Select.tsx
│  │  │  │  ├─ Sonner.tsx
│  │  │  │  ├─ Switch.tsx
│  │  │  │  ├─ Table.tsx
│  │  │  │  ├─ Tabs.tsx
│  │  │  │  ├─ Text.tsx
│  │  │  │  └─ TimePicker.tsx
│  │  │  ├─ site-header.tsx
│  │  │  ├─ sort-button.tsx
│  │  │  ├─ student
│  │  │  │  └─ suggestions
│  │  │  │     └─ StudySuggestionCard.tsx
│  │  │  ├─ student-lesson-detail-screen.tsx
│  │  │  ├─ subject-card-header.tsx
│  │  │  ├─ subject-card.tsx
│  │  │  ├─ submission-form.tsx
│  │  │  ├─ submission-viewer.tsx
│  │  │  ├─ tabs.tsx
│  │  │  ├─ teacher
│  │  │  │  └─ suggestions
│  │  │  │     └─ ManualSuggestionPanel.tsx
│  │  │  ├─ TeacherUIComponents
│  │  │  │  ├─ AnnouncementCard.tsx
│  │  │  │  ├─ ClassesCard.tsx
│  │  │  │  ├─ DashboardCard.tsx
│  │  │  │  └─ SubjectCard.tsx
│  │  │  ├─ to-do-item.tsx
│  │  │  └─ ui
│  │  │     ├─ avatar.tsx
│  │  │     ├─ badge.tsx
│  │  │     ├─ breadcrumb.tsx
│  │  │     ├─ button.tsx
│  │  │     ├─ card.tsx
│  │  │     ├─ chart.tsx
│  │  │     ├─ checkbox.tsx
│  │  │     ├─ drawer.tsx
│  │  │     ├─ dropdown-menu.tsx
│  │  │     ├─ input.tsx
│  │  │     ├─ label.tsx
│  │  │     ├─ progress.tsx
│  │  │     ├─ select.tsx
│  │  │     ├─ separator.tsx
│  │  │     ├─ sheet.tsx
│  │  │     ├─ sidebar.tsx
│  │  │     ├─ skeleton.tsx
│  │  │     ├─ sonner.tsx
│  │  │     ├─ table.tsx
│  │  │     ├─ tabs.tsx
│  │  │     ├─ toggle-group.tsx
│  │  │     ├─ toggle.tsx
│  │  │     └─ tooltip.tsx
│  │  ├─ context
│  │  │  ├─ AuthContext.tsx
│  │  │  └─ sidebar-config.tsx
│  │  ├─ hooks
│  │  │  ├─ use-mobile.ts
│  │  │  └─ use-navigation-progress.ts
│  │  ├─ layouts
│  │  │  ├─ app-content.tsx
│  │  │  └─ app-layout.tsx
│  │  ├─ lib
│  │  │  ├─ academic-periods.ts
│  │  │  ├─ api.ts
│  │  │  ├─ classwork-utils.ts
│  │  │  ├─ student-record-api.ts
│  │  │  ├─ suggestion-api.ts
│  │  │  └─ utils.ts
│  │  ├─ main.tsx
│  │  ├─ mocks
│  │  │  ├─ adminClasses.ts
│  │  │  └─ userAnalytics.ts
│  │  ├─ pages
│  │  │  ├─ admin
│  │  │  │  ├─ academic-periods.tsx
│  │  │  │  ├─ class-detail.tsx
│  │  │  │  ├─ classes.tsx
│  │  │  │  ├─ dashboard.tsx
│  │  │  │  ├─ data.json
│  │  │  │  ├─ forms
│  │  │  │  │  ├─ add-academic-level.tsx
│  │  │  │  │  ├─ add-academic-period.tsx
│  │  │  │  │  ├─ add-grading-component.tsx
│  │  │  │  │  ├─ add-subject-load.tsx
│  │  │  │  │  ├─ add-subject.tsx
│  │  │  │  │  └─ view-previous-periods.tsx
│  │  │  │  ├─ interventions.tsx
│  │  │  │  ├─ notifications.tsx
│  │  │  │  ├─ student-view.tsx
│  │  │  │  ├─ subject-level.tsx
│  │  │  │  ├─ subject-view.tsx
│  │  │  │  ├─ subjects
│  │  │  │  │  └─ components
│  │  │  │  │     ├─ CurriculumFilters.tsx
│  │  │  │  │     ├─ CurriculumPlanTable.tsx
│  │  │  │  │     ├─ EmptyStateCard.tsx
│  │  │  │  │     ├─ index.ts
│  │  │  │  │     ├─ SubjectContextBanner.tsx
│  │  │  │  │     ├─ SubjectModuleTabs.tsx
│  │  │  │  │     ├─ SubjectPicker.tsx
│  │  │  │  │     └─ TemplateSubjectPicker.tsx
│  │  │  │  ├─ subjects.tsx
│  │  │  │  ├─ system-settings.tsx
│  │  │  │  ├─ user-detail.tsx
│  │  │  │  └─ users.tsx
│  │  │  ├─ Login.tsx
│  │  │  ├─ SetupPassword.tsx
│  │  │  ├─ student
│  │  │  │  ├─ Grades
│  │  │  │  │  ├─ grades.tsx
│  │  │  │  │  └─ subject-grade.tsx
│  │  │  │  ├─ notifications.tsx
│  │  │  │  ├─ storyboard.tsx
│  │  │  │  ├─ student-profile.tsx
│  │  │  │  ├─ student-subject-detail.tsx
│  │  │  │  ├─ subject-view.tsx
│  │  │  │  ├─ Subjects
│  │  │  │  │  ├─ subject-detail.tsx
│  │  │  │  │  └─ tabs
│  │  │  │  │     ├─ subject-classwork-tab.tsx
│  │  │  │  │     ├─ subject-lesson-tab.tsx
│  │  │  │  │     └─ subject-suggestions-tab.tsx
│  │  │  │  ├─ subjects.tsx
│  │  │  │  ├─ todo-view.tsx
│  │  │  │  └─ todo.tsx
│  │  │  └─ teacher
│  │  │     ├─ Classes
│  │  │     │  ├─ class-detail.tsx
│  │  │     │  ├─ class-section.tsx
│  │  │     │  ├─ classes-page.tsx
│  │  │     │  ├─ subject-details
│  │  │     │  │  ├─ ClassworkFormModal.tsx
│  │  │     │  │  ├─ constants.ts
│  │  │     │  │  ├─ LessonClassworkList.tsx
│  │  │     │  │  ├─ MetricCard.tsx
│  │  │     │  │  ├─ StudentRecordsPanel.tsx
│  │  │     │  │  └─ types.ts
│  │  │     │  ├─ subject-details.tsx
│  │  │     │  └─ subjects.tsx
│  │  │     ├─ classworks
│  │  │     │  ├─ ClassworkCard.tsx
│  │  │     │  ├─ quiz-builder-types.ts
│  │  │     │  └─ quiz-builder-utils.ts
│  │  │     ├─ classworks.tsx
│  │  │     ├─ create-lesson.tsx
│  │  │     ├─ dashboard.tsx
│  │  │     ├─ draft-lessons.tsx
│  │  │     ├─ grades.tsx
│  │  │     ├─ lessons.tsx
│  │  │     └─ notifications.tsx
│  │  └─ types
│  │     ├─ adminClasses.ts
│  │     ├─ classwork.ts
│  │     ├─ index.d.ts
│  │     ├─ student-subject.ts
│  │     └─ suggestion.ts
│  ├─ tsconfig.app.json
│  ├─ tsconfig.json
│  ├─ tsconfig.node.json
│  └─ vite.config.ts
├─ mobile-app
│  ├─ .expo
│  │  ├─ devices.json
│  │  ├─ README.md
│  │  ├─ types
│  │  │  └─ router.d.ts
│  │  └─ web
│  │     └─ cache
│  │        └─ production
│  │           └─ images
│  │              └─ favicon
│  │                 └─ favicon-a4e030697a7571b3e95d31860e4da55d2f98e5e861e2b55e414f45a8556828ba-contain-transparent
│  │                    └─ favicon-48.png
│  ├─ app
│  │  ├─ (tabs)
│  │  │  ├─ explore.tsx
│  │  │  ├─ index.tsx
│  │  │  └─ _layout.tsx
│  │  ├─ login.tsx
│  │  ├─ modal.tsx
│  │  ├─ student
│  │  │  ├─ classwork-submit.tsx
│  │  │  ├─ classwork-view.tsx
│  │  │  ├─ grades.tsx
│  │  │  ├─ lesson-view.tsx
│  │  │  ├─ notifications.tsx
│  │  │  ├─ storyboard.tsx
│  │  │  ├─ subject-detail.tsx
│  │  │  ├─ subject-grade.tsx
│  │  │  ├─ subjects.tsx
│  │  │  ├─ todo.tsx
│  │  │  └─ _layout.tsx
│  │  ├─ teacher
│  │  │  ├─ classes-subject.tsx
│  │  │  ├─ classes.tsx
│  │  │  ├─ classwork-detail.tsx
│  │  │  ├─ classworks.tsx
│  │  │  ├─ create-classwork.tsx
│  │  │  ├─ create-lesson.tsx
│  │  │  ├─ Create_Classwork_Forms
│  │  │  │  ├─ assign-classwork-form.tsx
│  │  │  │  ├─ create-classwork-material.tsx
│  │  │  │  └─ new-classwork-form.tsx
│  │  │  ├─ Create_Lesson_Forms
│  │  │  │  ├─ add-lesson.tsx
│  │  │  │  ├─ import-creation.tsx
│  │  │  │  ├─ manual-creation.tsx
│  │  │  │  └─ upload-file.tsx
│  │  │  ├─ dashboard.tsx
│  │  │  ├─ edit-classwork.tsx
│  │  │  ├─ edit-lesson.tsx
│  │  │  ├─ grade-submission.tsx
│  │  │  ├─ grades.tsx
│  │  │  ├─ lesson-detail.tsx
│  │  │  ├─ lessons.tsx
│  │  │  ├─ subject-detail.tsx
│  │  │  ├─ submissions.tsx
│  │  │  └─ _layout.tsx
│  │  └─ _layout.tsx
│  ├─ app.json
│  ├─ assets
│  │  └─ images
│  │     ├─ android-icon-background.png
│  │     ├─ android-icon-foreground.png
│  │     ├─ android-icon-monochrome.png
│  │     ├─ favicon.png
│  │     ├─ icon.png
│  │     ├─ partial-react-logo.png
│  │     ├─ react-logo.png
│  │     ├─ react-logo@2x.png
│  │     ├─ react-logo@3x.png
│  │     └─ splash-icon.png
│  ├─ auth
│  │  └─ session-expired.ts
│  ├─ components
│  │  ├─ badge.tsx
│  │  ├─ card.tsx
│  │  ├─ classwork-card.tsx
│  │  ├─ DrawerMenu.tsx
│  │  ├─ external-link.tsx
│  │  ├─ haptic-tab.tsx
│  │  ├─ hello-wave.tsx
│  │  ├─ overview-card.tsx
│  │  ├─ parallax-scroll-view.tsx
│  │  ├─ student
│  │  │  ├─ ClassworkItem.tsx
│  │  │  ├─ DrawerMenu.tsx
│  │  │  ├─ LessonCard.tsx
│  │  │  ├─ NotificationCard.tsx
│  │  │  ├─ ScreenHeader.tsx
│  │  │  ├─ SubjectCard.tsx
│  │  │  ├─ SubjectCardHeader.tsx
│  │  │  ├─ TabBar.tsx
│  │  │  └─ ToDoItem.tsx
│  │  ├─ TabBar.tsx
│  │  ├─ teacher
│  │  │  ├─ add-button-form.tsx
│  │  │  ├─ classwork-modal-shell.tsx
│  │  │  ├─ date-picker-field.tsx
│  │  │  ├─ file-viewer.tsx
│  │  │  ├─ filter-cards.tsx
│  │  │  ├─ filter-dropdown.tsx
│  │  │  ├─ form-card.tsx
│  │  │  ├─ form-dropdown.tsx
│  │  │  ├─ form-footer.tsx
│  │  │  ├─ info-card.tsx
│  │  │  ├─ material-card.tsx
│  │  │  └─ submission-monitor.tsx
│  │  ├─ themed-text.tsx
│  │  ├─ themed-view.tsx
│  │  ├─ To-Do.tsx
│  │  └─ ui
│  │     ├─ collapsible.tsx
│  │     ├─ icon-symbol.ios.tsx
│  │     └─ icon-symbol.tsx
│  ├─ constants
│  │  ├─ api.ts
│  │  ├─ classwork-ui.ts
│  │  └─ theme.ts
│  ├─ context
│  │  ├─ AuthContext.tsx
│  │  └─ DrawerContext.tsx
│  ├─ eslint.config.js
│  ├─ expo-env.d.ts
│  ├─ hooks
│  │  ├─ api.ts
│  │  ├─ use-color-scheme.ts
│  │  ├─ use-color-scheme.web.ts
│  │  ├─ use-theme-color.ts
│  │  ├─ useClassworkAssignments.ts
│  │  ├─ useStudentSubjects.ts
│  │  ├─ useSubmissions.ts
│  │  ├─ useTeacherAcademicYear.ts
│  │  └─ useTeacherData.ts
│  ├─ package-lock.json
│  ├─ package.json
│  ├─ README.md
│  ├─ scripts
│  │  └─ reset-project.js
│  └─ tsconfig.json
├─ package-lock.json
├─ patch.js
├─ README.md
└─ runningman.md

```