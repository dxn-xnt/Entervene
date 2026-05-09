import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent.parent / "data"

def load_oulad():
    student_info = pd.read_csv(DATA_DIR / "studentInfo.csv")
    student_assess = pd.read_csv(DATA_DIR / "studentAssessment.csv")
    assessments = pd.read_csv(DATA_DIR / "assessments.csv")
    student_vle = pd.read_csv(DATA_DIR / "studentVle.csv")
    student_reg = pd.read_csv(DATA_DIR / "studentRegistration.csv")

    return student_info, student_assess, assessments, student_vle, student_reg