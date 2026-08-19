import os
import sys

# Add the backend directory to sys.path so we can import app modules
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.abspath(os.path.join(current_dir, ".."))
sys.path.append(backend_dir)

from sqlalchemy.orm import Session
from app.db.Session import SessionLocal
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.settings.Setting import Setting

def time_str_to_mins(t_str: str) -> int:
    if not t_str:
        return 9999
    try:
        h, m = t_str.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 9999

def format_mins(mins: int) -> str:
    if mins == 9999: return "INVALID"
    h = mins // 60
    m = mins % 60
    p = "AM" if h < 12 else "PM"
    if h > 12: h -= 12
    if h == 0: h = 12
    return f"{h}:{m:02d} {p}"

def get_school_hours(db: Session):
    settings = db.query(Setting).filter(Setting.key.in_(["school_day_start", "school_day_end"])).all()
    s_map = {s.key: s.value for s in settings}
    start = s_map.get("school_day_start", "06:00")
    end = s_map.get("school_day_end", "20:00")
    return start, end

def run():
    db = SessionLocal()
    try:
        start_str, end_str = get_school_hours(db)
        min_mins = time_str_to_mins(start_str)
        max_mins = time_str_to_mins(end_str)

        print(f"==================================================")
        print(f"School Hours Configuration: {start_str} to {end_str}")
        print(f"==================================================\n")

        print("Checking Period Template Slots...")
        slots = db.query(PeriodTemplateSlot).all()
        invalid_slots = []
        for s in slots:
            s_mins = time_str_to_mins(s.start_time)
            e_mins = time_str_to_mins(s.end_time)
            
            reasons = []
            if e_mins <= s_mins:
                reasons.append("End time <= Start time")
            if s_mins < min_mins or e_mins > max_mins:
                reasons.append("Outside school hours")
            
            if reasons:
                invalid_slots.append((s, reasons))
        
        if invalid_slots:
            for s, reasons in invalid_slots:
                print(f"[!] Invalid Template Slot ID {s.slot_id} ({s.slot_name}): {s.start_time} - {s.end_time} -> {', '.join(reasons)}")
        else:
            print("  All period templates are valid.\n")

        print("\nChecking Subject Loads...")
        loads = db.query(SubjectLoad).all()
        invalid_loads = []
        for l in loads:
            if not l.start_time or not l.end_time:
                continue
            s_mins = time_str_to_mins(l.start_time)
            e_mins = time_str_to_mins(l.end_time)

            reasons = []
            if e_mins <= s_mins:
                reasons.append("End time <= Start time")
            if s_mins < min_mins or e_mins > max_mins:
                reasons.append("Outside school hours")

            if reasons:
                invalid_loads.append((l, reasons))

        if invalid_loads:
            for l, reasons in invalid_loads:
                print(f"[!] Invalid Subject Load ID {l.subject_load_id} (Class {l.class_id}, Subject {l.subject_id}): {l.start_time} - {l.end_time} -> {', '.join(reasons)}")
        else:
            print("  All subject loads are valid.\n")

    finally:
        db.close()

if __name__ == "__main__":
    run()
