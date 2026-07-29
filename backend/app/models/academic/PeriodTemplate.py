from sqlalchemy import Column, String, Integer, Boolean
from app.db.Base import Base


class PeriodTemplate(Base):
    __tablename__ = "period_template"

    template_id    = Column(Integer, primary_key=True, autoincrement=True)
    template_group = Column(String(50), nullable=False)  # "JHS_45MIN", "SHS_CAMPOS_ZARA", "SHS_DELMUNDO_REYES"
    period_number  = Column(Integer, nullable=False)
    period_label   = Column(String(50), nullable=False)
    start_time     = Column(String(5), nullable=False)   # "08:00"
    end_time       = Column(String(5), nullable=False)     # "08:45"
    duration_mins  = Column(Integer, nullable=False)
    is_break       = Column(Boolean, default=False)
