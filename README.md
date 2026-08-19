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
```
Entervene
├─ backend
│  ├─ alembic.ini
│  ├─ app
│  │  ├─ api
│  │  │  ├─ v1
│  │  │  │  ├─ routes
│  │  │  │  │  ├─ Activities.py
│  │  │  │  │  ├─ AIAssist.py
│  │  │  │  │  ├─ Analytics.py
│  │  │  │  │  ├─ Attendance.py
│  │  │  │  │  ├─ Auth.py
│  │  │  │  │  ├─ Classes.py
│  │  │  │  │  ├─ Classworks.py
│  │  │  │  │  ├─ GradingTemplates.py
│  │  │  │  │  ├─ LessonPlans.py
│  │  │  │  │  ├─ Lessons.py
│  │  │  │  │  ├─ Notifications.py
│  │  │  │  │  ├─ Pathways.py
│  │  │  │  │  ├─ Predictions.py
│  │  │  │  │  ├─ Quizzes.py
│  │  │  │  │  ├─ Settings.py
│  │  │  │  │  ├─ StudentRecords.py
│  │  │  │  │  ├─ Students.py
│  │  │  │  │  ├─ SubjectGroups.py
│  │  │  │  │  ├─ SubjectLoads.py
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
│  │  │  ├─ SettingsCache.py
│  │  │  ├─ StaffId.py
│  │  │  └─ __init__.py
│  │  ├─ db
│  │  │  ├─ Base.py
│  │  │  ├─ seed_settings.py
│  │  │  ├─ Session.py
│  │  │  └─ __init__.py
│  │  ├─ main.py
│  │  ├─ ml
│  │  │  ├─ BuildTrainingDataset.py
│  │  │  ├─ DatasetPackValidator.py
│  │  │  ├─ ExtractEClassRecords.py
│  │  │  ├─ RegisterModelVersion.py
│  │  │  ├─ SavePrediction.py
│  │  │  ├─ ScorePrediction.py
│  │  │  ├─ SeedLivePredictions.py
│  │  │  ├─ Train.py
│  │  │  └─ __init__.py
│  │  ├─ models
│  │  │  ├─ academic
│  │  │  │  ├─ AcademicLevel.py
│  │  │  │  ├─ AcademicLevelPathwayScope.py
│  │  │  │  ├─ AcademicPathway.py
│  │  │  │  ├─ AcademicPeriod.py
│  │  │  │  ├─ AcademicYear.py
│  │  │  │  ├─ AssessmentItem.py
│  │  │  │  ├─ Class_.py
│  │  │  │  ├─ DepedCluster.py
│  │  │  │  ├─ GradingTemplate.py
│  │  │  │  ├─ GradingTemplateComponent.py
│  │  │  │  ├─ Lesson.py
│  │  │  │  ├─ LessonAssignment.py
│  │  │  │  ├─ LessonAttachment.py
│  │  │  │  ├─ LessonPlanModel.py
│  │  │  │  ├─ PeriodTemplate.py
│  │  │  │  ├─ PeriodTemplateSlot.py
│  │  │  │  ├─ StudentAssessmentScore.py
│  │  │  │  ├─ StudentCLass.py
│  │  │  │  ├─ StudentPeriodGrade.py
│  │  │  │  ├─ Subject.py
│  │  │  │  ├─ SubjectGroup.py
│  │  │  │  ├─ SubjectLoad.py
│  │  │  │  ├─ SubjectOffering.py
│  │  │  │  ├─ SubjectOfferingPathway.py
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
│  │  │  │  ├─ Attendance.py
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
│  │  │  │  ├─ Notification.py
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
│  │  │  ├─ settings
│  │  │  │  ├─ Setting.py
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
│  │  │  ├─ AcademicLevelPathwayScope.py
│  │  │  ├─ AcademicPathway.py
│  │  │  ├─ Activity.py
│  │  │  ├─ Attendance.py
│  │  │  ├─ Auth.py
│  │  │  ├─ Class.py
│  │  │  ├─ Classwork.py
│  │  │  ├─ GradingTemplate.py
│  │  │  ├─ Lesson.py
│  │  │  ├─ LessonPlan.py
│  │  │  ├─ Notification.py
│  │  │  ├─ Prediction.py
│  │  │  ├─ Quiz.py
│  │  │  ├─ Settings.py
│  │  │  ├─ Student.py
│  │  │  ├─ StudentRecord.py
│  │  │  ├─ Subject.py
│  │  │  ├─ SubjectGroup.py
│  │  │  ├─ SubjectLoad.py
│  │  │  ├─ SubjectOffering.py
│  │  │  ├─ Submission.py
│  │  │  ├─ Suggestion.py
│  │  │  ├─ User.py
│  │  │  └─ __init__.py
│  │  └─ services
│  │     ├─ academic
│  │     │  ├─ AutoSchedulerService.py
│  │     │  ├─ ConflictDetectorService.py
│  │     │  ├─ LessonPlanAIService.py
│  │     │  └─ LessonPlanService.py
│  │     ├─ AcademicPeriodService.py
│  │     ├─ activity
│  │     │  └─ ActivityService.py
│  │     ├─ attendance
│  │     │  └─ AttendanceService.py
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
│  │     ├─ NotificationService.py
│  │     ├─ pathways
│  │     │  ├─ PathwayQueryService.py
│  │     │  ├─ PathwayScopeService.py
│  │     │  ├─ PathwayService.py
│  │     │  ├─ PathwayShared.py
│  │     │  └─ __init__.py
│  │     ├─ prediction
│  │     │  ├─ DashboardFilterService.py
│  │     │  ├─ DashboardPredictionService.py
│  │     │  ├─ ModelPerformanceService.py
│  │     │  ├─ ModelScoringService.py
│  │     │  ├─ ModelVersionService.py
│  │     │  ├─ PredictionExplanationService.py
│  │     │  ├─ PredictionFeatureBuilderService.py
│  │     │  ├─ PredictionOutcomeService.py
│  │     │  ├─ PredictionPersistenceService.py
│  │     │  ├─ PredictionReadService.py
│  │     │  ├─ PredictionSuggestionService.py
│  │     │  ├─ RiskEngine.py
│  │     │  ├─ TeacherRiskReviewService.py
│  │     │  └─ __init__.py
│  │     ├─ quiz
│  │     │  ├─ QuizAnalysisService.py
│  │     │  ├─ QuizAttemptService.py
│  │     │  ├─ QuizBuilderService.py
│  │     │  ├─ QuizImportService.py
│  │     │  └─ __init__.py
│  │     ├─ settings
│  │     │  ├─ SettingsService.py
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
│  ├─ entervene.db
│  ├─ migrations
│  │  ├─ env.py
│  │  ├─ README
│  │  ├─ script.py.mako
│  │  └─ versions
│  │     ├─ 12aa5108d9e8_add_lessonplanmodel.py
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
│  │     ├─ 20260728_add_activity_mode.py
│  │     ├─ 20260728_add_class_pathway.py
│  │     ├─ 20260729_add_ctu_master_schedule_fields.py
│  │     ├─ 20260729_make_subject_load_staff_id_nullable.py
│  │     ├─ 20260812_add_academic_level_pathway_scope.py
│  │     ├─ 20260812_add_academic_pathways_and_join.py
│  │     ├─ 20260812_add_subject_groups.py
│  │     ├─ 20260812_drop_legacy_pathway_string_columns.py
│  │     ├─ 22b964f8c2e2_add_attendance_and_leave_request_tables.py
│  │     ├─ 27ae3176cae2_add_subject_load_versioning.py
│  │     ├─ 3379e1da9ceb_add_invitation_token_table.py
│  │     ├─ 525bfe30afd2_add_prediction_id_to_student_suggestion.py
│  │     ├─ 572462a5b498_merge_heads.py
│  │     ├─ 844db2477657_add_notification_table.py
│  │     ├─ 970d6f19b61d_rename_periodical_assessment_to_.py
│  │     ├─ b57b02a3f427_merge_heads.py
│  │     ├─ d31025bd1360_add_show_scores_to_classwork.py
│  │     ├─ d56daec34451_merge_lessonplan_and_suggestions.py
│  │     ├─ ea616545b5c4_add_setting_table.py
│  │     ├─ fd950c772501_update_grading_component_types.py
│  │     └─ fe064f391d28_add_start_time_end_time_days_of_week_to_.py
│  ├─ package-lock.json
│  ├─ pytest.ini
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
│  │  ├─ test_dashboard_predictions.py
│  │  ├─ test_dataset_pack_validator.py
│  │  ├─ test_grading_template_admin_api.py
│  │  ├─ test_lesson_authorization_lifecycle.py
│  │  ├─ test_ml_train.py
│  │  ├─ test_model_integrity.py
│  │  ├─ test_model_performance_summary.py
│  │  ├─ test_model_scoring_service.py
│  │  ├─ test_pathway_admin_api.py
│  │  ├─ test_pathway_scope_admin_api.py
│  │  ├─ test_prediction_detail_explanations.py
│  │  ├─ test_prediction_feature_builder_service.py
│  │  ├─ test_prediction_outcome_grade_finalization.py
│  │  ├─ test_prediction_outcome_service.py
│  │  ├─ test_prediction_persistence_service.py
│  │  ├─ test_prediction_read_endpoints.py
│  │  ├─ test_prediction_routes.py
│  │  ├─ test_prediction_suggestion_linking.py
│  │  ├─ test_quiz_analysis_api.py
│  │  ├─ test_quiz_attempt_api.py
│  │  ├─ test_quiz_builder_api.py
│  │  ├─ test_quiz_import_api.py
│  │  ├─ test_quiz_manual_grading.py
│  │  ├─ test_quiz_model_integrity.py
│  │  ├─ test_register_model_version.py
│  │  ├─ test_risk_engine.py
│  │  ├─ test_role_permissions_enforcement.py
│  │  ├─ test_security.py
│  │  ├─ test_student_class_integrity.py
│  │  ├─ test_student_class_summary.py
│  │  ├─ test_student_period_grade_finalization.py
│  │  ├─ test_student_record_api.py
│  │  ├─ test_student_suggestion_workflow.py
│  │  ├─ test_subject_admin_api.py
│  │  ├─ test_subject_import_api.py
│  │  ├─ test_subject_loads_and_settings.py
│  │  ├─ test_subject_offering_admin_api.py
│  │  ├─ test_subject_offering_import_api.py
│  │  ├─ test_suggestion_api.py
│  │  ├─ test_suggestion_model_integrity.py
│  │  ├─ test_suggestion_role_isolation.py
│  │  ├─ test_teacher_risk_review.py
│  │  ├─ test_term_specific_subject_loads.py
│  │  ├─ test_user_list.py
│  │  ├─ test_user_manual_create.py
│  │  └─ test_user_student_import.py
│  ├─ test_temp
│  │  ├─ test_directory_csv_discovery0
│  │  │  ├─ a.csv
│  │  │  ├─ b.csv
│  │  │  └─ notes.txt
│  │  ├─ test_load_json_helpers0
│  │  │  ├─ report.json
│  │  │  └─ schema.json
│  │  ├─ test_runtime_only_risk_fields_0
│  │  │  └─ model.joblib
│  │  ├─ test_score_student_prediction_0
│  │  │  └─ model.joblib
│  │  └─ test_training_works_on_tiny_sy0
│  │     ├─ ml
│  │     │  ├─ 03_random_forest_regression_train.csv
│  │     │  └─ 04_random_forest_regression_test.csv
│  │     └─ models
│  │        ├─ tiny_rf.joblib
│  │        ├─ tiny_rf_feature_importance.csv
│  │        ├─ tiny_rf_feature_schema.json
│  │        └─ tiny_rf_training_report.json
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
├─ entervene.db
├─ fix.js
├─ frontend
│  ├─ components.json
│  ├─ eslint.config.js
│  ├─ index.html
│  ├─ package-lock.json
│  ├─ package.json
│  ├─ public
│  │  ├─ avatars
│  │  │  ├─ student-avatars
│  │  │  │  ├─ 1.svg
│  │  │  │  ├─ 10.svg
│  │  │  │  ├─ 11.svg
│  │  │  │  ├─ 2.svg
│  │  │  │  ├─ 3.svg
│  │  │  │  ├─ 4.svg
│  │  │  │  ├─ 5.svg
│  │  │  │  ├─ 6.svg
│  │  │  │  ├─ 7.svg
│  │  │  │  ├─ 8.svg
│  │  │  │  └─ 9.svg
│  │  │  └─ teacher-avatars
│  │  │     ├─ 12.svg
│  │  │     ├─ 13.svg
│  │  │     ├─ 14.svg
│  │  │     ├─ 15.svg
│  │  │     ├─ 16.svg
│  │  │     ├─ 17.svg
│  │  │     ├─ 18.svg
│  │  │     ├─ 19.svg
│  │  │     └─ 20.svg
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
│  │  │  │     ├─ class-card.tsx
│  │  │  │     ├─ fields
│  │  │  │     │  ├─ Field.tsx
│  │  │  │     │  └─ SelectField.tsx
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
│  │  │  ├─ dialogue-select.tsx
│  │  │  ├─ dynamic-schedule-table.tsx
│  │  │  ├─ item-line
│  │  │  │  ├─ class.tsx
│  │  │  │  ├─ grade.tsx
│  │  │  │  └─ subject.tsx
│  │  │  ├─ lesson-form.tsx
│  │  │  ├─ lesson-modal.tsx
│  │  │  ├─ nav-documents.tsx
│  │  │  ├─ nav-main.tsx
│  │  │  ├─ nav-secondary.tsx
│  │  │  ├─ nav-user.tsx
│  │  │  ├─ navigation-progress.tsx
│  │  │  ├─ notification-card.tsx
│  │  │  ├─ notification-drawer.tsx
│  │  │  ├─ overview-cards.tsx
│  │  │  ├─ pdf-viewer.tsx
│  │  │  ├─ predictions
│  │  │  │  ├─ PredictionDetailSheet.tsx
│  │  │  │  ├─ PredictionFilters.tsx
│  │  │  │  ├─ PredictionTable.tsx
│  │  │  │  ├─ RiskDistributionChart.tsx
│  │  │  │  └─ RiskSummaryCards.tsx
│  │  │  ├─ profile-header.tsx
│  │  │  ├─ protected-route.tsx
│  │  │  ├─ quiz-grading-modal.tsx
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
│  │  │     ├─ button.tsx
│  │  │     ├─ card.tsx
│  │  │     ├─ chart.tsx
│  │  │     ├─ checkbox.tsx
│  │  │     ├─ context-menu.tsx
│  │  │     ├─ drawer.tsx
│  │  │     ├─ dropdown-menu.tsx
│  │  │     ├─ empty.tsx
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
│  │  │  ├─ SettingsContext.tsx
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
│  │  │  ├─ attendance-api.ts
│  │  │  ├─ classwork-utils.ts
│  │  │  ├─ interventions-api.ts
│  │  │  ├─ notifications-api.ts
│  │  │  ├─ prediction-api.ts
│  │  │  ├─ quiz-api.ts
│  │  │  ├─ settings-api.ts
│  │  │  ├─ student-record-api.ts
│  │  │  ├─ subject-groups-api.ts
│  │  │  ├─ suggestion-api.ts
│  │  │  └─ utils.ts
│  │  ├─ main.tsx
│  │  ├─ mocks
│  │  │  ├─ adminClasses.ts
│  │  │  └─ userAnalytics.ts
│  │  ├─ pages
│  │  │  ├─ admin
│  │  │  │  ├─ academic-periods.tsx
│  │  │  │  ├─ class-level-view.tsx
│  │  │  │  ├─ class-view.tsx
│  │  │  │  ├─ classes.tsx
│  │  │  │  ├─ dashboard.tsx
│  │  │  │  ├─ data.json
│  │  │  │  ├─ forms
│  │  │  │  │  ├─ add-academic-level.tsx
│  │  │  │  │  ├─ add-academic-period.tsx
│  │  │  │  │  ├─ add-class.tsx
│  │  │  │  │  ├─ add-grading-component.tsx
│  │  │  │  │  ├─ add-grading-template.tsx
│  │  │  │  │  ├─ add-subject-load.tsx
│  │  │  │  │  ├─ add-subject.tsx
│  │  │  │  │  ├─ add-user.tsx
│  │  │  │  │  ├─ BreakConfigDrawer.tsx
│  │  │  │  │  ├─ classes
│  │  │  │  │  │  ├─ add-class-method-selection.tsx
│  │  │  │  │  │  ├─ archive-class.tsx
│  │  │  │  │  │  ├─ edit-class.tsx
│  │  │  │  │  │  ├─ edit-student-list.tsx
│  │  │  │  │  │  ├─ import-class-wizard.tsx
│  │  │  │  │  │  ├─ manual-class-wizard.tsx
│  │  │  │  │  │  └─ modal-shell.tsx
│  │  │  │  │  └─ view-previous-periods.tsx
│  │  │  │  ├─ interventions.tsx
│  │  │  │  ├─ notifications.tsx
│  │  │  │  ├─ profile-view.tsx
│  │  │  │  ├─ student-view.tsx
│  │  │  │  ├─ subject-level-view.tsx
│  │  │  │  ├─ subject-load-studio.tsx
│  │  │  │  ├─ subject-view.tsx
│  │  │  │  ├─ subjects
│  │  │  │  │  └─ components
│  │  │  │  │     ├─ copy-previous-year-setup-modal.tsx
│  │  │  │  │     ├─ CurriculumFilters.tsx
│  │  │  │  │     ├─ CurriculumPlanTable.tsx
│  │  │  │  │     ├─ EmptyStateCard.tsx
│  │  │  │  │     ├─ grading-template-row.tsx
│  │  │  │  │     ├─ index.ts
│  │  │  │  │     ├─ loading-card.tsx
│  │  │  │  │     ├─ offering-modal.tsx
│  │  │  │  │     ├─ offering-row.tsx
│  │  │  │  │     ├─ subject-catalog-card.tsx
│  │  │  │  │     ├─ subject-grade-section.tsx
│  │  │  │  │     ├─ subject-row.tsx
│  │  │  │  │     ├─ subject-utils.tsx
│  │  │  │  │     ├─ SubjectContextBanner.tsx
│  │  │  │  │     ├─ SubjectPicker.tsx
│  │  │  │  │     └─ TemplateSubjectPicker.tsx
│  │  │  │  ├─ subjects.tsx
│  │  │  │  ├─ system-settings.tsx
│  │  │  │  ├─ user-detail.tsx
│  │  │  │  └─ users.tsx
│  │  │  ├─ Login.tsx
│  │  │  ├─ quiz
│  │  │  │  ├─ quiz-interface.tsx
│  │  │  │  ├─ quiz-result.tsx
│  │  │  │  └─ quiz-view.tsx
│  │  │  ├─ SetupPassword.tsx
│  │  │  ├─ student
│  │  │  │  ├─ attendance.tsx
│  │  │  │  ├─ Grades
│  │  │  │  │  ├─ grades.tsx
│  │  │  │  │  └─ subject-grade.tsx
│  │  │  │  ├─ notifications.tsx
│  │  │  │  ├─ storyboard.tsx
│  │  │  │  ├─ student-interventions.tsx
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
│  │  │     ├─ attendance
│  │  │     │  └─ index.tsx
│  │  │     ├─ attendance.tsx
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
│  │  │     │  │  ├─ TeacherLessonDetailScreen.tsx
│  │  │     │  │  └─ types.ts
│  │  │     │  ├─ subject-details.tsx
│  │  │     │  └─ subjects.tsx
│  │  │     ├─ classworks
│  │  │     │  ├─ ClassworkCard.tsx
│  │  │     │  ├─ quiz-builder-types.ts
│  │  │     │  ├─ quiz-builder-utils.ts
│  │  │     │  └─ QuizAnalysisView.tsx
│  │  │     ├─ classworks.tsx
│  │  │     ├─ create-lesson.tsx
│  │  │     ├─ dashboard.tsx
│  │  │     ├─ draft-lessons.tsx
│  │  │     ├─ forms
│  │  │     │  ├─ add-classwork-score.tsx
│  │  │     │  ├─ attendance-modal.tsx
│  │  │     │  ├─ create-classwork-quiz.tsx
│  │  │     │  ├─ create-classwork.tsx
│  │  │     │  ├─ enter-manual-scores.tsx
│  │  │     │  └─ view-grade-scores.tsx
│  │  │     ├─ grade-view copy.tsx
│  │  │     ├─ grade-view.tsx
│  │  │     ├─ grades.tsx
│  │  │     ├─ LessonPlanner
│  │  │     │  ├─ components
│  │  │     │  │  └─ AIAssistButton.tsx
│  │  │     │  ├─ LessonPlanExporter.ts
│  │  │     │  ├─ LessonPlannerListPage.tsx
│  │  │     │  ├─ LessonPlannerPage.tsx
│  │  │     │  ├─ LessonPlannerWizard.tsx
│  │  │     │  ├─ tabs
│  │  │     │  │  ├─ AssessmentTab.tsx
│  │  │     │  │  ├─ InfoTab.tsx
│  │  │     │  │  ├─ IntentionsTab.tsx
│  │  │     │  │  ├─ LearningExpTab.tsx
│  │  │     │  │  └─ WaysForwardTab.tsx
│  │  │     │  └─ useLessonPlanner.ts
│  │  │     ├─ lessons.tsx
│  │  │     ├─ notifications.tsx
│  │  │     ├─ predictions.tsx
│  │  │     └─ profile-view.tsx
│  │  ├─ services
│  │  │  └─ attendanceService.ts
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
├─ how --stat 67b6aa2
├─ mobile-app
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