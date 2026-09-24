"""Boundary contract copied from the client Grades 2–10 ECR HELPER table."""

from decimal import Decimal

import pytest

from app.services.grading.CurrentThreeTermTransmutation import transmute_current_three_term_grade
from app.services.student_record.StudentRecordService import _deped_transmuted


# Each row is (minimum Initial Grade, maximum Initial Grade, Term Grade).
ECR_INTERVALS = [
    ("0.00", "4.67", 60), ("4.68", "9.34", 61),
    ("9.35", "14.00", 62), ("14.01", "18.67", 63),
    ("18.68", "23.34", 64), ("23.35", "28.00", 65),
    ("28.01", "32.67", 66), ("32.68", "37.33", 67),
    ("37.34", "42.00", 68), ("42.01", "46.66", 69),
    ("46.67", "51.33", 70), ("51.34", "56.00", 71),
    ("56.01", "60.66", 72), ("60.67", "65.33", 73),
    ("65.34", "69.99", 74), ("70.00", "71.17", 75),
    ("71.18", "72.35", 76), ("72.36", "73.53", 77),
    ("73.54", "74.71", 78), ("74.72", "75.89", 79),
    ("75.90", "77.07", 80), ("77.08", "78.25", 81),
    ("78.26", "79.43", 82), ("79.44", "80.61", 83),
    ("80.62", "81.79", 84), ("81.80", "82.97", 85),
    ("82.98", "84.15", 86), ("84.16", "85.33", 87),
    ("85.34", "86.51", 88), ("86.52", "87.69", 89),
    ("87.70", "88.87", 90), ("88.88", "90.05", 91),
    ("90.06", "91.23", 92), ("91.24", "92.41", 93),
    ("92.42", "93.59", 94), ("93.60", "94.77", 95),
    ("94.78", "95.95", 96), ("95.96", "97.13", 97),
    ("97.14", "98.31", 98), ("98.32", "99.49", 99),
    ("99.50", "100.00", 100),
]


@pytest.mark.parametrize("minimum,maximum,term_grade", ECR_INTERVALS)
def test_every_source_interval_boundary(minimum, maximum, term_grade):
    for point in (Decimal(minimum), Decimal(maximum)):
        assert transmute_current_three_term_grade(point) == term_grade
        assert _deped_transmuted(float(point)) == term_grade


def test_workbook_example_and_grade_limits():
    assert transmute_current_three_term_grade(Decimal("87.90")) == 90
    assert transmute_current_three_term_grade(Decimal("-1")) == 60
    assert transmute_current_three_term_grade(Decimal("101")) == 100
