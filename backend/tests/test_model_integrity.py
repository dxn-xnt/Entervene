from app.models.people.Student import Student
from app.models.people.AcademicStaff import AcademicStaff
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.submissions.StudentSubmission import StudentSubmission


def test_student_has_user_and_academic_level_foreign_keys():
    assert Student.__table__.c.user_id.foreign_keys
    assert Student.__table__.c.academic_level_id.foreign_keys


def test_academic_staff_has_user_foreign_key():
    assert AcademicStaff.__table__.c.user_id.foreign_keys


def test_performance_indexes_exist():
    classwork_index_names = {index.name for index in ClassworkAssignment.__table__.indexes}
    submission_index_names = {index.name for index in StudentSubmission.__table__.indexes}

    assert "ix_classwork_assignment_class_published_due" in classwork_index_names
    assert "ix_student_submission_assignment_student" in submission_index_names
