from pydantic import BaseModel


class SettingRead(BaseModel):
    """Single setting returned from the API."""

    key: str
    value: str
    type: str           # "string" | "boolean" | "integer" | "json"
    group: str
    is_public: bool
    description: str | None = None


class SettingUpdate(BaseModel):
    """Payload for updating a setting value.

    The value is always sent as a string and validated server-side
    against the setting's declared type.
    """

    value: str


class SettingsGroupedResponse(BaseModel):
    """All settings, grouped by their ``group`` column (admin UI)."""

    groups: dict[str, list[SettingRead]]


class SettingsPublicResponse(BaseModel):
    """Flat key→value dict of public settings (frontend consumption)."""

    settings: dict[str, str]


class AcademicYearRead(BaseModel):
    academic_year_id: int
    year_label: str
    start_date: str | None = None
    end_date: str | None = None
    is_active: bool

    class Config:
        from_attributes = True


class AcademicYearListResponse(BaseModel):
    years: list[AcademicYearRead]


class AcademicPeriodCreateItem(BaseModel):
    period_sequence: int
    start_date: str
    end_date: str


class AcademicPeriodCreateRequest(BaseModel):
    academic_year_id: int
    period_type: str = "TERM"
    periods: list[AcademicPeriodCreateItem]


class AcademicPeriodRead(BaseModel):
    academic_period_id: int
    academic_year_id: int
    period_type: str
    period_sequence: int
    period_name: str
    start_date: str | None = None
    end_date: str | None = None
    is_active: bool

    class Config:
        from_attributes = True

