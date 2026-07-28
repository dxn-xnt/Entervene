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
