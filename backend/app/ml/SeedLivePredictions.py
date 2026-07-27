"""
SeedLivePredictions.py
======================
CLI script that reads final_student_risk_predictions.csv and bulk-inserts
all scored records into the ai_prediction and prediction_outcome tables.

DATA UNIVERSE NOTE
------------------
The CSV contains 1,271 unique synthetic student IDs (STU-XXX-Y-N format) from
the real E-Class Record workbooks.  The live Entervene DB has only ~20
development-seed students and subjects named 'Mathematics 7', 'Science 7', etc.
The CSV one-hot subject columns reference 'MATHEMATICS', 'SCIENCE', 'ICT',
'ELECTRONICS', 'CREATIVE_TECHNOLOGY', 'VALUES_EDUCATION' -- none of which have
exact matches in the DB.  MAPEH-family rows (ARTS, ENGLISH, HEALTH, MUSIC, PE)
have no subject flag at all.

Resolution strategy
-------------------
Phase 0 -- Auto-create missing subjects
  The script ensures all subjects referenced by the CSV exist in the subject
  table before any ai_prediction rows are inserted.  New subjects are created
  with subject_group = 'LIVE_IMPORT' and academic_level_id = 1 (placeholder).

Phase 1 -- Upsert synthetic students
  Deterministic UUID (uuid5) + synthetic LRN derived from the STU-XXX-Y-N key.
  Idempotent: re-running the script with the same CSV produces the same UUIDs.

Phase 2 -- Insert ai_prediction rows
  Subject:  one-hot flag map -> subject name -> subject_id (created in Phase 0)
            MAPEH rows: derive subject from period string prefix (ARTS, ENGLISH, etc.)
  Period:   quarter suffix Q1-Q4 -> academic_period.period_sequence
  Class:    first class linked to that academic_period_id, else global fallback

Phase 3 -- Insert prediction_outcome rows (outcome_status = PENDING)

Usage
-----
cd backend
.venv\\Scripts\\python.exe -m app.ml.SeedLivePredictions --dry-run
.venv\\Scripts\\python.exe -m app.ml.SeedLivePredictions --model-version-id 1
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import sys
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# All subjects that appear in the CSV (one-hot flags + MAPEH period prefixes)
# subject_key -> (subject_name, subject_codename)
# ---------------------------------------------------------------------------
REQUIRED_SUBJECTS: dict[str, tuple[str, str]] = {
    # One-hot flag columns
    "creative_technology": ("Creative Technology", "CT"),
    "electronics":         ("Electronics", "ELEC"),
    "ict":                 ("ICT", "ICT"),
    "mathematics":         ("Mathematics (Generic)", "MATH"),
    "science":             ("Science (Generic)", "SCI"),
    "values_education":    ("Values Education", "VE"),
    # MAPEH subjects (derived from period string prefix)
    "arts":                ("Arts", "ARTS"),
    "english":             ("English (Generic)", "ENG"),
    "health":              ("Health", "HEALTH"),
    "music":               ("Music", "MUSIC"),
    "pe":                  ("Physical Education", "PE"),
    # Additional subjects seen in file_source names
    "adv_physics":         ("Advanced Physics", "ADV-PHY"),
    "con_chem":            ("Conceptual Chemistry", "CON-CHEM"),
    "perdev":              ("Personal Development", "PERDEV"),
    "precalculus":         ("Pre-Calculus (Generic)", "PRECAL"),
}

# One-hot column -> subject key
ONEHOT_TO_KEY: dict[str, str] = {
    "subject_CREATIVE_TECHNOLOGY": "creative_technology",
    "subject_ELECTRONICS":         "electronics",
    "subject_ICT":                 "ict",
    "subject_MATHEMATICS":         "mathematics",
    "subject_SCIENCE":             "science",
    "subject_VALUES_EDUCATION":    "values_education",
}

# Period prefix -> subject key (for rows with no one-hot flag)
PERIOD_PREFIX_TO_KEY: dict[str, str] = {
    "ARTS":        "arts",
    "ENGLISH":     "english",
    "HEALTH":      "health",
    "MUSIC":       "music",
    "PE":          "pe",
    "ADV":         "adv_physics",   # ADV. PHYSICS_Q1
    "CON":         "con_chem",      # CON CHEM_Q1
    "PERDEV":      "perdev",
    "PRECALCULUS": "precalculus",
    "PRECAL":      "precalculus",
}

_QUARTER_RE = re.compile(r"[_\s]Q([1-4])\b", re.IGNORECASE)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _deterministic_uuid(seed: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_DNS, f"entervene.synthetic.student.{seed}")


def _synthetic_lrn(student_key: str) -> str:
    h = hashlib.md5(student_key.encode()).hexdigest()
    digits = re.sub(r"[^0-9]", "", h)[:12].ljust(12, "0")
    return "9" + digits[1:]


def _parse_name(original_name: str) -> tuple[str, Optional[str], str]:
    parts = [p.strip().title() for p in original_name.split(",")]
    last_name  = parts[0] if len(parts) > 0 else "Unknown"
    first_name = parts[1] if len(parts) > 1 else "Unknown"
    middle_name = parts[2] if len(parts) > 2 else None
    return last_name, middle_name, first_name


def _resolve_quarter(period_string: str) -> Optional[int]:
    m = _QUARTER_RE.search(period_string)
    if m:
        return int(m.group(1))
    ordinals = {"1ST": 1, "2ND": 2, "3RD": 3, "4TH": 4}
    return ordinals.get(period_string.strip().upper())


def _detect_subject_key(row: dict) -> Optional[str]:
    """Return the subject key for this row using one-hot flags first, period prefix second."""
    # 1. One-hot flag
    for col, key in ONEHOT_TO_KEY.items():
        try:
            if float(row.get(col, 0)) == 1.0:
                return key
        except (ValueError, TypeError):
            continue

    # 2. Period prefix fallback (covers MAPEH subjects)
    period = row.get("period", "").strip().upper()
    for prefix, key in PERIOD_PREFIX_TO_KEY.items():
        if period.startswith(prefix):
            return key

    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed live ML predictions into ai_prediction and prediction_outcome tables."
    )
    parser.add_argument(
        "--csv-path",
        default="data/live_predictions/final_student_risk_predictions.csv",
    )
    parser.add_argument("--model-version-id", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse and resolve without writing to DB.")
    parser.add_argument("--replace", action="store_true",
                        help="Delete existing predictions for this model version first.")
    args = parser.parse_args()

    csv_path = Path(args.csv_path)
    if not csv_path.exists():
        print(f"ERROR: CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    # Load .env
    import os
    _env_file = Path(__file__).resolve().parents[3] / ".env"
    if _env_file.exists():
        for line in _env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())

    from app.db.Session import SessionLocal
    from app.models.people.Student import Student
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.models.academic.Subject import Subject
    from app.models.academic.Class_ import Class
    from app.models.ai.AIModelVersion import AIModelVersion
    from app.models.ai.AIPrediction import AIPrediction
    from app.models.ai.PredictionOutcome import PredictionOutcome

    db = SessionLocal()

    # ------------------------------------------------------------------ Phase 0: ensure subjects
    print("=== Phase 0: Ensure required subjects exist ===")

    existing_subjects = db.query(Subject).all()
    # Build lookup: codename (upper) -> subject_id
    codename_to_id: dict[str, int] = {
        s.subject_codename.upper(): s.subject_id
        for s in existing_subjects
        if s.subject_codename
    }
    # Also lower name map
    name_to_id: dict[str, int] = {
        s.subject_name.lower(): s.subject_id for s in existing_subjects
    }

    subject_key_to_id: dict[str, int] = {}

    for key, (name, codename) in REQUIRED_SUBJECTS.items():
        # Try codename first, then name
        sid = codename_to_id.get(codename.upper()) or name_to_id.get(name.lower())
        if sid:
            subject_key_to_id[key] = sid
            print(f"  {key}: already in DB (id={sid})")
        else:
            # Need to create
            new_sub = Subject(
                subject_name=name,
                subject_codename=codename,
                subject_group="LIVE_IMPORT",
                status="active",
                academic_level_id=1,  # Grade 7 placeholder — not used for display
            )
            if not args.dry_run:
                db.add(new_sub)
                db.flush()
                subject_key_to_id[key] = new_sub.subject_id
                codename_to_id[codename.upper()] = new_sub.subject_id
                name_to_id[name.lower()] = new_sub.subject_id
                print(f"  {key}: CREATED '{name}' (id={new_sub.subject_id})")
            else:
                print(f"  {key}: [DRY-RUN] Would create '{name}' ({codename})")
                subject_key_to_id[key] = -1  # placeholder for dry-run

    if not args.dry_run:
        db.commit()

    # ------------------------------------------------------------------ load remaining lookups
    print("\nLoading DB lookup tables...")

    period_rows = db.query(AcademicPeriod).all()
    period_seq_map: dict[int, int] = {p.period_sequence: p.academic_period_id for p in period_rows}
    print(f"  academic_period sequences available: {sorted(period_seq_map.keys())}")

    class_rows = db.query(Class).all()
    period_class_map: dict[int, int] = {}
    fallback_class_id: Optional[int] = None
    for c in class_rows:
        if c.academic_period_id is not None:
            period_class_map.setdefault(c.academic_period_id, c.class_id)
        if fallback_class_id is None:
            fallback_class_id = c.class_id
    print(f"  class rows: {len(class_rows)}, period->class: {period_class_map}, fallback class_id={fallback_class_id}")

    mv = db.get(AIModelVersion, args.model_version_id)
    if mv is None:
        print(f"ERROR: ai_model_version id={args.model_version_id} not found.", file=sys.stderr)
        db.close()
        sys.exit(1)
    print(f"  model: id={mv.model_version_id}  name={mv.model_name!r}  active={mv.is_active}")

    existing_uuids: set[uuid.UUID] = {r.student_id for r in db.query(Student.student_id).all()}
    existing_lrns: set[str] = {r.student_lrn for r in db.query(Student.student_lrn).all()}

    # ------------------------------------------------------------------ read CSV
    print(f"\nReading CSV: {csv_path}...")
    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    print(f"  Total rows in CSV: {len(rows)}")

    # ------------------------------------------------------------------ Phase 1: students
    print("\n=== Phase 1: Synthetic student upsert ===")
    student_key_map: dict[str, uuid.UUID] = {}
    new_students: list[dict] = []
    seen_keys: set[str] = set()

    for row in rows:
        key = row["student_id"].strip()
        if key in seen_keys:
            continue
        seen_keys.add(key)

        stu_uuid = _deterministic_uuid(key)
        student_key_map[key] = stu_uuid

        if stu_uuid in existing_uuids:
            continue

        lrn = _synthetic_lrn(key)
        attempt = 0
        base_lrn = lrn
        while lrn in existing_lrns:
            attempt += 1
            lrn = str(int(base_lrn) + attempt).zfill(12)[:12]

        last_name, middle_name, first_name = _parse_name(row.get("original_name", key))
        marker = "[live-prediction-import]"
        new_students.append({
            "student_id": stu_uuid,
            "student_lrn": lrn,
            "first_name": first_name,
            "middle_name": f"{middle_name} {marker}" if middle_name else marker,
            "last_name": last_name,
        })
        existing_uuids.add(stu_uuid)
        existing_lrns.add(lrn)

    print(f"  Unique CSV student IDs  : {len(seen_keys)}")
    print(f"  Already in DB           : {len(seen_keys) - len(new_students)}")
    print(f"  New students to insert  : {len(new_students)}")

    if not args.dry_run and new_students:
        for i in range(0, len(new_students), args.batch_size):
            batch = new_students[i: i + args.batch_size]
            db.bulk_insert_mappings(Student, batch)
            db.commit()
            print(f"    Student batch {i // args.batch_size + 1}: {len(batch)} rows")
        print("  Student phase complete.")
    elif args.dry_run:
        print(f"  [DRY-RUN] Would insert {len(new_students)} student rows")

    # ------------------------------------------------------------------ Phase 2: ai_prediction
    print("\n=== Phase 2: ai_prediction insertion ===")

    if args.replace and not args.dry_run:
        deleted = db.query(AIPrediction).filter(
            AIPrediction.model_version_id == args.model_version_id
        ).delete()
        db.commit()
        print(f"  [REPLACE] Deleted {deleted} existing predictions")

    prediction_batch: list[dict] = []
    inserted_count = 0
    skipped_count = 0
    skip_reasons: dict[str, int] = {}

    for idx, row in enumerate(rows):
        key = row["student_id"].strip()
        stu_uuid = student_key_map.get(key)
        if stu_uuid is None:
            skip_reasons["unresolved_student"] = skip_reasons.get("unresolved_student", 0) + 1
            skipped_count += 1
            continue

        quarter_seq = _resolve_quarter(row.get("period", ""))
        if quarter_seq is None:
            skip_reasons["unresolved_quarter"] = skip_reasons.get("unresolved_quarter", 0) + 1
            skipped_count += 1
            continue

        period_id = period_seq_map.get(quarter_seq)
        if period_id is None:
            skip_reasons["no_db_period"] = skip_reasons.get("no_db_period", 0) + 1
            skipped_count += 1
            continue

        subject_key = _detect_subject_key(row)
        if subject_key is None:
            skip_reasons["no_subject_detected"] = skip_reasons.get("no_subject_detected", 0) + 1
            skipped_count += 1
            continue

        subject_id = subject_key_to_id.get(subject_key)
        if subject_id is None:
            skip_reasons["unresolved_subject_id"] = skip_reasons.get("unresolved_subject_id", 0) + 1
            skipped_count += 1
            continue
        # In dry-run mode, subject_id is -1 (placeholder) -- still count it as resolved
        if subject_id == -1 and not args.dry_run:
            skip_reasons["unresolved_subject_id"] = skip_reasons.get("unresolved_subject_id", 0) + 1
            skipped_count += 1
            continue

        class_id = period_class_map.get(period_id, fallback_class_id)
        if class_id is None:
            skip_reasons["no_class"] = skip_reasons.get("no_class", 0) + 1
            skipped_count += 1
            continue

        try:
            predicted_grade = Decimal(str(row["predicted_period_grade"])).quantize(Decimal("0.01"))
        except Exception:
            predicted_grade = None

        try:
            risk_score = Decimal(str(row["risk_score"])).quantize(Decimal("0.0001"))
        except Exception:
            risk_score = None

        risk_level = row.get("risk_level", "NEEDS_MONITORING").strip()

        prediction_batch.append({
            "student_id": stu_uuid,
            "class_id": class_id,
            "subject_id": subject_id,
            "source_period_id": period_id,
            "target_period_id": period_id,
            "predicted_period_grade": predicted_grade,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "data_status": "SUFFICIENT",
            "model_version_id": args.model_version_id,
        })
        inserted_count += 1

        if (idx + 1) % 500 == 0:
            print(f"  Processed {idx + 1}/{len(rows)} rows...")

    print(f"\n  Rows resolved for insertion : {inserted_count}")
    print(f"  Rows skipped                : {skipped_count}")
    if skip_reasons:
        print("  Skip breakdown:")
        for reason, count in sorted(skip_reasons.items(), key=lambda x: -x[1]):
            print(f"    {reason}: {count}")

    if not args.dry_run and prediction_batch:
        print(f"\n  Inserting {len(prediction_batch)} ai_prediction rows...")
        for i in range(0, len(prediction_batch), args.batch_size):
            batch = prediction_batch[i: i + args.batch_size]
            db.bulk_insert_mappings(AIPrediction, batch)
            db.commit()
            print(f"    Prediction batch {i // args.batch_size + 1}: {len(batch)} rows committed")
        print("  ai_prediction phase complete.")
    elif args.dry_run:
        print(f"\n  [DRY-RUN] Would insert {len(prediction_batch)} ai_prediction rows")

    # ------------------------------------------------------------------ Phase 3: outcomes
    print("\n=== Phase 3: prediction_outcome insertion (PENDING) ===")

    if not args.dry_run and prediction_batch:
        inserted_ids = [
            r.prediction_id
            for r in db.query(AIPrediction.prediction_id)
            .filter(AIPrediction.model_version_id == args.model_version_id)
            .all()
        ]
        print(f"  Creating outcome rows for {len(inserted_ids)} predictions...")
        outcome_batch: list[dict] = [
            {"prediction_id": pid, "outcome_status": "PENDING"}
            for pid in inserted_ids
        ]
        for i in range(0, len(outcome_batch), args.batch_size):
            batch = outcome_batch[i: i + args.batch_size]
            db.bulk_insert_mappings(PredictionOutcome, batch)
            db.commit()
            print(f"    Outcome batch {i // args.batch_size + 1}: {len(batch)} rows committed")
        print("  prediction_outcome phase complete.")
    elif args.dry_run:
        print(f"  [DRY-RUN] Would insert {inserted_count} prediction_outcome rows (PENDING)")

    # ------------------------------------------------------------------ summary
    print("\n========== SEEDING SUMMARY ==========")
    print(f"  CSV rows total              : {len(rows)}")
    print(f"  New students inserted       : {len(new_students)}")
    print(f"  ai_prediction rows          : {inserted_count}")
    print(f"  prediction_outcome rows     : {inserted_count}")
    print(f"  Rows skipped                : {skipped_count}")
    if args.dry_run:
        print("  Mode: DRY RUN -- no changes written")
    else:
        print("  Mode: LIVE -- all changes committed")
    print("=====================================")

    db.close()


if __name__ == "__main__":
    main()
