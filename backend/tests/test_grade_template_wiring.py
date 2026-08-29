from decimal import Decimal
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.services.student_record.StudentRecordService import (
    FALLBACK_GRADING_WEIGHTS,
    GradingWeights,
    _deped_grade,
    _match_component_category,
    resolve_subject_grading_weights,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_match_component_category():
    assert _match_component_category("Written Works") == "WW"
    assert _match_component_category("Written Work") == "WW"
    assert _match_component_category("Seatworks / Quizzes") == "WW"
    assert _match_component_category("Performance Tasks") == "PT"
    assert _match_component_category("Project / Activity") == "PT"
    assert _match_component_category("Quarterly Assessment") == "QA"
    assert _match_component_category("Quarterly/Term Assessment") == "QA"
    assert _match_component_category("Periodic Exam") == "QA"
    assert _match_component_category("Term Examination") == "QA"
    assert _match_component_category("Unknown Component") is None


def test_resolve_weights_fallback_when_no_template(db: Session):
    subject = Subject(
        subject_name="Test No Template Subject",
        subject_codename="NOTPL",
        default_grading_template=None,
    )
    db.add(subject)
    db.commit()

    weights = resolve_subject_grading_weights(db, subject.subject_id)
    assert weights.ww_weight == FALLBACK_GRADING_WEIGHTS.ww_weight
    assert weights.pt_weight == FALLBACK_GRADING_WEIGHTS.pt_weight
    assert weights.qa_weight == FALLBACK_GRADING_WEIGHTS.qa_weight
    assert weights.template_id is None


def test_resolve_weights_by_template_name(db: Session):
    template = GradingTemplate(
        template_name="Math Custom Template",
        status="active",
    )
    db.add(template)
    db.flush()

    c1 = GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Written Work", weight=Decimal("40.00"), display_order=1)
    c2 = GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Performance Task", weight=Decimal("40.00"), display_order=2)
    c3 = GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Quarterly Exam", weight=Decimal("20.00"), display_order=3)
    db.add_all([c1, c2, c3])

    subject = Subject(
        subject_name="Math 9 Advanced",
        subject_codename="M9ADV",
        default_grading_template="Math Custom Template",
    )
    db.add(subject)
    db.commit()

    weights = resolve_subject_grading_weights(db, subject.subject_id)
    assert weights.template_id == template.grading_template_id
    assert pytest.approx(weights.ww_weight, 0.001) == 0.40
    assert pytest.approx(weights.pt_weight, 0.001) == 0.40
    assert pytest.approx(weights.qa_weight, 0.001) == 0.20


def test_resolve_weights_by_subject_id_link(db: Session):
    subject = Subject(
        subject_name="Science Direct Link",
        subject_codename="SCIDIR",
        default_grading_template=None,
    )
    db.add(subject)
    db.flush()

    template = GradingTemplate(
        template_name="Direct Link Template",
        subject_id=subject.subject_id,
        status="active",
    )
    db.add(template)
    db.flush()

    c1 = GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Written", weight=Decimal("25.00"), display_order=1)
    c2 = GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Performance", weight=Decimal("50.00"), display_order=2)
    c3 = GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("25.00"), display_order=3)
    db.add_all([c1, c2, c3])
    db.commit()

    weights = resolve_subject_grading_weights(db, subject.subject_id)
    assert weights.template_id == template.grading_template_id
    assert pytest.approx(weights.ww_weight, 0.001) == 0.25
    assert pytest.approx(weights.pt_weight, 0.001) == 0.50
    assert pytest.approx(weights.qa_weight, 0.001) == 0.25


def test_deped_grade_with_custom_weights():
    # Setup dummy classwork assignments
    cw_ww = Classwork(classwork_id=1, title="Quiz 1", total_points=100, classwork_category="WRITTEN_WORK", classwork_type="QUIZ", is_graded=True)
    asgn_ww = ClassworkAssignment(classwork_assignment_id=1, classwork_id=1, classwork=cw_ww)

    cw_pt = Classwork(classwork_id=2, title="PT 1", total_points=100, classwork_category="PERFORMANCE_TASK", classwork_type="ACTIVITY", is_graded=True)
    asgn_pt = ClassworkAssignment(classwork_assignment_id=2, classwork_id=2, classwork=cw_pt)

    cw_qa = Classwork(classwork_id=3, title="Exam", total_points=100, classwork_category="QUARTERLY_ASSESSMENT", classwork_type="EXAM", is_graded=True)
    asgn_qa = ClassworkAssignment(classwork_assignment_id=3, classwork_id=3, classwork=cw_qa)

    # Student scores: WW = 80/100 (80%), PT = 90/100 (90%), QA = 70/100 (70%)
    scores_ww = [80.0]
    scores_pt = [90.0]
    scores_qa = [70.0]

    # Test 1: With Fallback Weights (30% WW, 50% PT, 20% QA)
    # Expected IG = 0.30*80 + 0.50*90 + 0.20*70 = 24 + 45 + 14 = 83.0
    _, _, _, ig_fallback, _ = _deped_grade(
        scores_ww, [asgn_ww],
        scores_pt, [asgn_pt],
        scores_qa, [asgn_qa],
        weights=GradingWeights(ww_weight=0.30, pt_weight=0.50, qa_weight=0.20),
    )
    assert ig_fallback == 83.0

    # Test 2: With 25/50/25 Template Weights
    # Expected IG = 0.25*80 + 0.50*90 + 0.25*70 = 20 + 45 + 17.5 = 82.5
    _, _, _, ig_25_50_25, _ = _deped_grade(
        scores_ww, [asgn_ww],
        scores_pt, [asgn_pt],
        scores_qa, [asgn_qa],
        weights=GradingWeights(ww_weight=0.25, pt_weight=0.50, qa_weight=0.25),
    )
    assert ig_25_50_25 == 82.5

    # Test 3: With Math 40/40/20 Template Weights
    # Expected IG = 0.40*80 + 0.40*90 + 0.20*70 = 32 + 36 + 14 = 82.0
    _, _, _, ig_40_40_20, _ = _deped_grade(
        scores_ww, [asgn_ww],
        scores_pt, [asgn_pt],
        scores_qa, [asgn_qa],
        weights=GradingWeights(ww_weight=0.40, pt_weight=0.40, qa_weight=0.20),
    )
    assert ig_40_40_20 == 82.0
