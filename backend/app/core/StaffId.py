from sqlalchemy.orm import Session
from app.models.people.AcademicStaff import AcademicStaff


def generate_staff_id(db: Session) -> str:
    """Generates the next staff ID in format YYYY-NNNN."""
    from datetime import date
    year = date.today().year

    prefix = f"{year}-"
    last = (
        db.query(AcademicStaff.staff_id)
        .filter(AcademicStaff.staff_id.like(f"{prefix}%"))
        .order_by(AcademicStaff.staff_id.desc())
        .first()
    )

    if last:
        seq = int(last.staff_id.split("-")[1]) + 1
    else:
        seq = 1

    return f"{prefix}{seq:04d}"