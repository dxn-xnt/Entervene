"""
Unit tests for DepEd Order No. 015, s. 2026 (Memo 576, s. 2026) Performance Descriptors.
"""

from app.schemas.StudentRecord import (
    SendGradeToAdviserItemResponse,
    StudentGradebookRow,
    StudentPeriodGradeFinalizeResponse,
    TermGradeSummaryRow,
)
from app.services.student_record.StudentRecordService import (
    BAND_ADVANCING_MIN,
    BAND_BENCHMARKING_MIN,
    BAND_CONNECTING_MIN,
    BAND_DEVELOPING_MIN,
    DESCRIPTOR_ADVANCING,
    DESCRIPTOR_BENCHMARKING,
    DESCRIPTOR_CONNECTING,
    DESCRIPTOR_DEVELOPING,
    DESCRIPTOR_EMERGING,
    get_performance_descriptor,
)


def test_performance_descriptor_constants():
    """Verify band constants match DepEd Order No. 015, s. 2026."""
    assert BAND_ADVANCING_MIN == 90.0
    assert BAND_BENCHMARKING_MIN == 80.0
    assert BAND_CONNECTING_MIN == 75.0
    assert BAND_DEVELOPING_MIN == 65.0

    assert DESCRIPTOR_ADVANCING == "Advancing"
    assert DESCRIPTOR_BENCHMARKING == "Benchmarking"
    assert DESCRIPTOR_CONNECTING == "Connecting"
    assert DESCRIPTOR_DEVELOPING == "Developing"
    assert DESCRIPTOR_EMERGING == "Emerging"


def test_performance_descriptor_boundaries():
    """
    Test exact boundary values:
      90–100 -> Advancing
      80–89  -> Benchmarking
      75–79  -> Connecting
      65–74  -> Developing
      0–64   -> Emerging
    """
    # Advancing (90-100)
    assert get_performance_descriptor(100.0) == "Advancing"
    assert get_performance_descriptor(95.5) == "Advancing"
    assert get_performance_descriptor(90.0) == "Advancing"

    # Benchmarking (80-89)
    assert get_performance_descriptor(89.9) == "Benchmarking"
    assert get_performance_descriptor(89.0) == "Benchmarking"
    assert get_performance_descriptor(85.0) == "Benchmarking"
    assert get_performance_descriptor(80.0) == "Benchmarking"

    # Connecting (75-79)
    assert get_performance_descriptor(79.9) == "Connecting"
    assert get_performance_descriptor(79.0) == "Connecting"
    assert get_performance_descriptor(77.5) == "Connecting"
    assert get_performance_descriptor(75.0) == "Connecting"

    # Developing (65-74)
    assert get_performance_descriptor(74.9) == "Developing"
    assert get_performance_descriptor(74.0) == "Developing"
    assert get_performance_descriptor(70.0) == "Developing"
    assert get_performance_descriptor(65.0) == "Developing"

    # Emerging (0-64)
    assert get_performance_descriptor(64.9) == "Emerging"
    assert get_performance_descriptor(64.0) == "Emerging"
    assert get_performance_descriptor(50.0) == "Emerging"
    assert get_performance_descriptor(0.0) == "Emerging"

    # None input
    assert get_performance_descriptor(None) is None


def test_schema_serialization_includes_descriptor():
    """Ensure all relevant schemas properly serialize performance_descriptor."""
    gradebook_row = StudentGradebookRow(
        student_id="student-1",
        name="Juan Dela Cruz",
        writtenWork=[90.0],
        performanceTask=[85.0],
        total="88.0",
        transmuted_grade=88.0,
        performance_descriptor="Benchmarking",
    )
    assert gradebook_row.performance_descriptor == "Benchmarking"

    adviser_item = SendGradeToAdviserItemResponse(
        student_id="student-1",
        name="Juan Dela Cruz",
        final_period_grade=92.0,
        performance_descriptor="Advancing",
        is_finalized=True,
        status="newly_sent",
    )
    assert adviser_item.performance_descriptor == "Advancing"

    summary_row = TermGradeSummaryRow(
        student_id="student-1",
        name="Juan Dela Cruz",
        term_grades={1: 85.0, 2: 90.0},
        final_grade=87.5,
        remark="PASSED",
        performance_descriptor="Benchmarking",
    )
    assert summary_row.remark == "PASSED"
    assert summary_row.performance_descriptor == "Benchmarking"
