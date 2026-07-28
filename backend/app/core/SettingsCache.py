"""
TTL-based, thread-safe, in-memory settings cache.

Multi-worker safe:
  - Worker that handles PUT → invalidate() → instant reload on next read.
  - Other workers → stale for at most `ttl_seconds`, then auto-reload from DB.

Usage anywhere in the backend:
    from app.core.SettingsCache import settings_cache

    val = settings_cache.get("app_name", default="ENTERVENE")
    num = settings_cache.get("max_file_upload_mb", default=10)   # → int
    on  = settings_cache.get("enable_ai_features", default=True) # → bool
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CachedSetting:
    """Immutable snapshot of a single setting row."""

    key: str
    value: str          # raw string from DB
    type: str           # "string" | "boolean" | "integer" | "json"
    group: str
    is_public: bool
    description: str | None


class SettingsCache:
    """Thread-safe, TTL-based in-memory settings cache."""

    def __init__(self, ttl_seconds: int = 60) -> None:
        self._cache: dict[str, CachedSetting] = {}
        self._lock = threading.Lock()
        self._loaded_at: float = 0.0
        self._ttl = ttl_seconds

    # ── Loading ──────────────────────────────────────────────────────

    def _is_stale(self) -> bool:
        return (time.time() - self._loaded_at) > self._ttl

    def load_all(self, db) -> None:
        """Read every Setting row and populate the cache.

        Uses a lazy import so the module can be imported before the
        Setting model or its table exist (e.g., during migrations).
        """
        from app.models.settings.Setting import Setting  # lazy

        with self._lock:
            try:
                rows = db.query(Setting).all()
                self._cache = {
                    row.key: CachedSetting(
                        key=row.key,
                        value=row.value,
                        type=row.type.value,
                        group=row.group,
                        is_public=row.is_public,
                        description=row.description,
                    )
                    for row in rows
                }
                self._loaded_at = time.time()
                logger.info("SettingsCache loaded %d settings.", len(self._cache))
            except Exception:
                # Table may not exist yet (pre-migration). Keep the old cache.
                logger.warning("SettingsCache.load_all failed — table may not exist yet.", exc_info=True)

    def _ensure_loaded(self, db=None) -> None:
        """Lazily reload if the cache is stale **and** a db session is available."""
        if self._is_stale() and db is not None:
            self.load_all(db)

    def invalidate(self) -> None:
        """Force the next read to reload from DB (on this worker)."""
        with self._lock:
            self._loaded_at = 0.0

    # ── Getters ──────────────────────────────────────────────────────

    def get(self, key: str, default=None, *, db=None):
        """Get a single setting, auto-parsed to its Python type.

        Parameters
        ----------
        key : str
            The setting key (e.g. ``"session_timeout_minutes"``).
        default
            Returned when the key is missing from the cache.
        db : Session | None
            If provided and the cache is stale, triggers an auto-reload.
            Safe to omit — the cache will still return the last-known value
            loaded on startup or by a previous request.
        """
        self._ensure_loaded(db)
        entry = self._cache.get(key)
        if entry is None:
            return default
        return self._parse(entry)

    def get_raw(self, key: str, default: str = "", *, db=None) -> str:
        """Get the raw string value without type parsing."""
        self._ensure_loaded(db)
        entry = self._cache.get(key)
        return entry.value if entry is not None else default

    def get_all_public(self, *, db=None) -> dict[str, str]:
        """Return ``{key: value}`` for ``is_public=True`` settings only."""
        self._ensure_loaded(db)
        return {k: v.value for k, v in self._cache.items() if v.is_public}

    def get_all_grouped(self, *, db=None) -> dict[str, list[dict]]:
        """Return settings grouped by their ``group`` column (for admin UI)."""
        self._ensure_loaded(db)
        groups: dict[str, list[dict]] = {}
        for entry in self._cache.values():
            groups.setdefault(entry.group, []).append({
                "key": entry.key,
                "value": entry.value,
                "type": entry.type,
                "group": entry.group,
                "is_public": entry.is_public,
                "description": entry.description,
            })
        return groups

    # ── Type parsing ─────────────────────────────────────────────────

    @staticmethod
    def _parse(entry: CachedSetting):
        """Convert the raw string value to its native Python type."""
        if entry.type == "boolean":
            return entry.value.lower() == "true"
        if entry.type == "integer":
            try:
                return int(entry.value)
            except (ValueError, TypeError):
                return 0
        if entry.type == "json":
            try:
                return json.loads(entry.value)
            except (json.JSONDecodeError, TypeError):
                return {}
        return entry.value  # string


# ── Module-level singleton ───────────────────────────────────────────
# Imported as: from app.core.SettingsCache import settings_cache
settings_cache = SettingsCache(ttl_seconds=60)
