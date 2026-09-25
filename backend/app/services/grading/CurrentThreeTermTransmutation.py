"""Initial Grade to Term Grade lookup from the supplied current three-term ECR."""

from decimal import Decimal


# Descending HELPER!B8:B48 minima and HELPER!D8:D48 Term Grades.
CURRENT_THREE_TERM_BOUNDS = (
    ("99.50", 100), ("98.32", 99), ("97.14", 98), ("95.96", 97),
    ("94.78", 96), ("93.60", 95), ("92.42", 94), ("91.24", 93),
    ("90.06", 92), ("88.88", 91), ("87.70", 90), ("86.52", 89),
    ("85.34", 88), ("84.16", 87), ("82.98", 86), ("81.80", 85),
    ("80.62", 84), ("79.44", 83), ("78.26", 82), ("77.08", 81),
    ("75.90", 80), ("74.72", 79), ("73.54", 78), ("72.36", 77),
    ("71.18", 76), ("70.00", 75), ("65.34", 74), ("60.67", 73),
    ("56.01", 72), ("51.34", 71), ("46.67", 70), ("42.01", 69),
    ("37.34", 68), ("32.68", 67), ("28.01", 66), ("23.35", 65),
    ("18.68", 64), ("14.01", 63), ("9.35", 62), ("4.68", 61),
    ("0.00", 60),
)


def transmute_current_three_term_grade(initial_grade: float | Decimal) -> float:
    """Match the workbook's descending minimum bound, without interpolation."""
    grade = max(Decimal("0"), min(Decimal("100"), Decimal(str(initial_grade))))
    for minimum, term_grade in CURRENT_THREE_TERM_BOUNDS:
        if grade >= Decimal(minimum):
            return float(term_grade)
    return 60.0
