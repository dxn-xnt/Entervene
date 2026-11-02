from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Settings import router as settings_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.settings.Setting import Setting, SettingType
from app.services.academic.AcademicLifecycleService import (
    activate_academic_year,
    resolve_active_academic_period,
    resolve_active_academic_year,
)


@pytest.fixture
def lifecycle_context():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = Session(engine, autoflush=False)
    actor = uuid4()

    historical = AcademicYear(
        year_label="2024-2025",
        start_date=date(2024, 8, 1),
        end_date=date(2025, 5, 31),
        is_active=False,
    )
    current = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 8, 1),
        end_date=date(2026, 5, 31),
        is_active=True,
    )
    future = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=False,
    )
    empty_future = AcademicYear(
        year_label="2027-2028",
        start_date=date(2027, 8, 1),
        end_date=date(2028, 5, 31),
        is_active=False,
    )
    db.add_all([historical, current, future, empty_future])
    db.flush()

    historical_period = AcademicPeriod(
        academic_year_id=historical.academic_year_id,
        period_name="Term 3",
        period_type="TERM",
        period_sequence=3,
        total_periods_in_year=3,
        start_date=date(2025, 2, 1),
        end_date=date(2025, 5, 31),
        is_active=False,
    )
    current_period = AcademicPeriod(
        academic_year_id=current.academic_year_id,
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        start_date=date(2025, 11, 16),
        end_date=date(2026, 2, 15),
        is_active=True,
    )
    future_first = AcademicPeriod(
        academic_year_id=future.academic_year_id,
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 11, 15),
        is_active=False,
    )
    future_second = AcademicPeriod(
        academic_year_id=future.academic_year_id,
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        start_date=date(2026, 11, 16),
        end_date=date(2027, 2, 15),
        is_active=False,
    )
    db.add_all([historical_period, current_period, future_first, future_second])
    db.flush()
    protected_grade = StudentPeriodGrade(
        student_id=uuid4(),
        class_id=9001,
        subject_id=9001,
        academic_period_id=historical_period.academic_period_id,
        final_period_grade=Decimal("91"),
        is_finalized=True,
    )
    db.add_all([
        protected_grade,
        Setting(
            key="current_school_year",
            value=current.year_label,
            type=SettingType.STRING,
            group="calendar",
            is_public=True,
        ),
        Setting(
            key="active_term",
            value=str(current_period.period_sequence),
            type=SettingType.STRING,
            group="calendar",
            is_public=True,
        ),
    ])
    db.commit()

    identity = {"sub": str(actor), "role": "admin"}
    api = FastAPI()
    api.include_router(settings_router, prefix="/api/v1/settings")
    api.dependency_overrides[get_db] = lambda: db
    api.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(api) as client:
        yield {
            "db": db,
            "client": client,
            "actor": actor,
            "identity": identity,
            "historical": historical,
            "current": current,
            "future": future,
            "empty_future": empty_future,
            "historical_period": historical_period,
            "current_period": current_period,
            "future_first": future_first,
            "future_second": future_second,
            "protected_grade": protected_grade,
        }

    db.close()
    Base.metadata.drop_all(engine)
    engine.dispose()


def _setting(db: Session, key: str) -> str:
    return db.query(Setting.value).filter(Setting.key == key).scalar()


def test_switching_year_selects_first_configured_period_and_clears_all_old_flags(lifecycle_context):
    c = lifecycle_context
    # Seed a legacy active period on historical year to verify it is cleared
    hist_period = c["db"].get(AcademicPeriod, c["historical_period"].academic_period_id)
    hist_period.is_active = True
    c["db"].commit()

    response = c["client"].put(
        f"/api/v1/settings/active-academic-year/{c['future'].academic_year_id}"
    )

    assert response.status_code == 200, response.text
    assert response.json()["academic_period_id"] == c["future_first"].academic_period_id
    c["db"].expire_all()
    assert resolve_active_academic_year(c["db"]).academic_year_id == c["future"].academic_year_id
    assert resolve_active_academic_period(c["db"]).academic_period_id == c["future_first"].academic_period_id
    assert _setting(c["db"], "current_school_year") == c["future"].year_label
    assert _setting(c["db"], "active_term") == "1"
    assert c["db"].query(AcademicPeriod).filter(AcademicPeriod.is_active.is_(True)).count() == 1
    grade = c["db"].get(StudentPeriodGrade, c["protected_grade"].period_grade_id)
    assert grade.is_finalized is True and grade.final_period_grade == Decimal("91")
    assert c["db"].get(AcademicPeriod, c["historical_period"].academic_period_id) is not None


def test_period_from_inactive_year_is_rejected_without_partial_change(lifecycle_context):
    c = lifecycle_context
    response = c["client"].put(
        f"/api/v1/settings/active-period/{c['future_first'].academic_period_id}"
    )

    assert response.status_code == 409
    c["db"].expire_all()
    assert c["db"].get(AcademicYear, c["current"].academic_year_id).is_active is True
    assert c["db"].get(AcademicPeriod, c["current_period"].academic_period_id).is_active is True
    assert _setting(c["db"], "current_school_year") == c["current"].year_label
    assert _setting(c["db"], "active_term") == "2"


def test_year_without_periods_fails_safely(lifecycle_context):
    c = lifecycle_context
    response = c["client"].put(
        f"/api/v1/settings/active-academic-year/{c['empty_future'].academic_year_id}"
    )

    assert response.status_code == 409
    c["db"].expire_all()
    assert resolve_active_academic_year(c["db"]).academic_year_id == c["current"].academic_year_id
    assert _setting(c["db"], "current_school_year") == c["current"].year_label
    assert _setting(c["db"], "active_term") == "2"


@pytest.mark.parametrize("key,value", [
    ("current_school_year", "2026-2027"),
    ("active_term", "1"),
])
def test_generic_setting_route_cannot_bypass_lifecycle(key, value, lifecycle_context):
    c = lifecycle_context
    response = c["client"].put(f"/api/v1/settings/{key}", json={"value": value})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "ACADEMIC_LIFECYCLE_ACTION_REQUIRED"


def test_activation_is_idempotent_and_admin_only(lifecycle_context):
    c = lifecycle_context
    url = f"/api/v1/settings/active-academic-year/{c['future'].academic_year_id}"
    first = c["client"].put(url)
    second = c["client"].put(url)
    assert first.status_code == second.status_code == 200
    assert first.json()["academic_period_id"] == second.json()["academic_period_id"]

    c["identity"]["role"] = "teacher"
    denied = c["client"].put(
        f"/api/v1/settings/active-period/{c['future_second'].academic_period_id}"
    )
    assert denied.status_code == 403


def test_failed_commit_rolls_back_year_period_and_settings(lifecycle_context, monkeypatch):
    c = lifecycle_context

    def fail_commit():
        raise RuntimeError("synthetic commit failure")

    monkeypatch.setattr(c["db"], "commit", fail_commit)
    with pytest.raises(RuntimeError, match="synthetic commit failure"):
        activate_academic_year(
            c["db"],
            academic_year_id=c["future"].academic_year_id,
            actor_user_id=c["actor"],
        )

    c["db"].expire_all()
    assert resolve_active_academic_year(c["db"]).academic_year_id == c["current"].academic_year_id
    assert c["db"].get(AcademicPeriod, c["current_period"].academic_period_id).is_active is True
    assert _setting(c["db"], "current_school_year") == c["current"].year_label
    assert _setting(c["db"], "active_term") == "2"


def test_switching_year_preserves_sole_active_period_if_configured(lifecycle_context):
    c = lifecycle_context
    future_second = c["db"].get(AcademicPeriod, c["future_second"].academic_period_id)
    future_second.is_active = True
    c["db"].commit()

    response = c["client"].put(
        f"/api/v1/settings/active-academic-year/{c['future'].academic_year_id}"
    )

    assert response.status_code == 200, response.text
    assert response.json()["academic_period_id"] == c["future_second"].academic_period_id
    assert response.json()["period_sequence"] == 2
    c["db"].expire_all()
    assert resolve_active_academic_year(c["db"]).academic_year_id == c["future"].academic_year_id
    assert resolve_active_academic_period(c["db"]).academic_period_id == c["future_second"].academic_period_id
    assert _setting(c["db"], "current_school_year") == c["future"].year_label
    assert _setting(c["db"], "active_term") == "2"
    assert c["db"].query(AcademicPeriod).filter(AcademicPeriod.is_active.is_(True)).count() == 1


def test_switching_year_heals_multiple_active_periods_in_target_year(lifecycle_context):
    c = lifecycle_context
    p1 = c["db"].get(AcademicPeriod, c["future_first"].academic_period_id)
    p2 = c["db"].get(AcademicPeriod, c["future_second"].academic_period_id)
    p1.is_active = True
    p2.is_active = True
    c["db"].commit()

    response = c["client"].put(
        f"/api/v1/settings/active-academic-year/{c['future'].academic_year_id}"
    )

    assert response.status_code == 200, response.text
    assert response.json()["academic_period_id"] == c["future_first"].academic_period_id
    assert response.json()["period_sequence"] == 1
    c["db"].expire_all()
    assert resolve_active_academic_year(c["db"]).academic_year_id == c["future"].academic_year_id
    assert resolve_active_academic_period(c["db"]).academic_period_id == c["future_first"].academic_period_id
    assert _setting(c["db"], "current_school_year") == c["future"].year_label
    assert _setting(c["db"], "active_term") == "1"
    assert c["db"].query(AcademicPeriod).filter(AcademicPeriod.is_active.is_(True)).count() == 1


def test_activating_already_active_period_is_idempotent(lifecycle_context):
    c = lifecycle_context
    response = c["client"].put(
        f"/api/v1/settings/active-period/{c['current_period'].academic_period_id}"
    )

    assert response.status_code == 200
    assert response.json()["academic_period_id"] == c["current_period"].academic_period_id
    assert response.json()["period_sequence"] == c["current_period"].period_sequence
    c["db"].expire_all()
    assert resolve_active_academic_period(c["db"]).academic_period_id == c["current_period"].academic_period_id
    assert _setting(c["db"], "active_term") == str(c["current_period"].period_sequence)


def test_activating_nonexistent_year_and_period_returns_404(lifecycle_context):
    c = lifecycle_context
    year_resp = c["client"].put("/api/v1/settings/active-academic-year/999999")
    assert year_resp.status_code == 404
    assert "Academic year not found." in year_resp.text

    period_resp = c["client"].put("/api/v1/settings/active-period/999999")
    assert period_resp.status_code == 404
    assert "Academic period not found." in period_resp.text


def test_lifecycle_resolution_conflict_guards(lifecycle_context):
    c = lifecycle_context
    db = c["db"]

    historical = db.get(AcademicYear, c["historical"].academic_year_id)
    historical.is_active = True
    db.commit()

    with pytest.raises(Exception) as exc_info:
        resolve_active_academic_year(db)
    assert exc_info.value.status_code == 409
    assert "multiple academic years are active" in exc_info.value.detail

    historical.is_active = False
    db.commit()

    future_first = db.get(AcademicPeriod, c["future_first"].academic_period_id)
    future_first.is_active = True
    db.commit()

    with pytest.raises(Exception) as exc_info:
        resolve_active_academic_period(db)
    assert exc_info.value.status_code == 409
    assert "multiple grading periods are active" in exc_info.value.detail

    current_period = db.get(AcademicPeriod, c["current_period"].academic_period_id)
    historical_period = db.get(AcademicPeriod, c["historical_period"].academic_period_id)
    current_period.is_active = False
    historical_period.is_active = False
    # Now only future_first (in future year) is active globally, while current year is active
    db.commit()

    with pytest.raises(Exception) as exc_info:
        resolve_active_academic_period(db)
    assert exc_info.value.status_code == 409
    assert "not in the active academic year" in exc_info.value.detail

    future_first.is_active = False
    db.commit()

    with pytest.raises(Exception) as exc_info:
        resolve_active_academic_period(db, required=True)
    assert exc_info.value.status_code == 409
    assert "No active grading period is configured" in exc_info.value.detail

    assert resolve_active_academic_period(db, required=False) is None


def test_activating_another_period_in_active_year_switches_term(lifecycle_context):
    c = lifecycle_context
    # Add Term 1 to current year
    current_term1 = AcademicPeriod(
        academic_year_id=c["current"].academic_year_id,
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2025, 8, 1),
        end_date=date(2025, 11, 15),
        is_active=False,
    )
    c["db"].add(current_term1)
    c["db"].commit()

    response = c["client"].put(
        f"/api/v1/settings/active-period/{current_term1.academic_period_id}"
    )

    assert response.status_code == 200
    assert response.json()["academic_period_id"] == current_term1.academic_period_id
    assert response.json()["period_sequence"] == 1
    c["db"].expire_all()
    assert resolve_active_academic_year(c["db"]).academic_year_id == c["current"].academic_year_id
    assert resolve_active_academic_period(c["db"]).academic_period_id == current_term1.academic_period_id
    assert _setting(c["db"], "current_school_year") == c["current"].year_label
    assert _setting(c["db"], "active_term") == "1"
    # Ensure current_period (Term 2) is now inactive
    assert c["db"].get(AcademicPeriod, c["current_period"].academic_period_id).is_active is False


def test_admin_can_configure_future_year_periods_without_affecting_active_state(lifecycle_context):
    c = lifecycle_context
    # Admin configures periods for empty_future year
    response = c["client"].post(
        "/api/v1/settings/academic-periods",
        json={
            "academic_year_id": c["empty_future"].academic_year_id,
            "period_type": "TERM",
            "periods": [
                {"period_sequence": 1, "start_date": "2027-08-01", "end_date": "2027-11-15"},
                {"period_sequence": 2, "start_date": "2027-11-16", "end_date": "2028-02-15"},
                {"period_sequence": 3, "start_date": "2028-02-16", "end_date": "2028-05-31"},
            ],
        },
    )

    assert response.status_code == 200
    c["db"].expire_all()
    # Active year and period remain unchanged
    assert resolve_active_academic_year(c["db"]).academic_year_id == c["current"].academic_year_id
    assert resolve_active_academic_period(c["db"]).academic_period_id == c["current_period"].academic_period_id
    assert _setting(c["db"], "current_school_year") == c["current"].year_label
    assert _setting(c["db"], "active_term") == "2"
    # New periods are configured but inactive
    new_periods = (
        c["db"].query(AcademicPeriod)
        .filter(AcademicPeriod.academic_year_id == c["empty_future"].academic_year_id)
        .all()
    )
    assert len(new_periods) == 3
    assert all(not p.is_active for p in new_periods)
