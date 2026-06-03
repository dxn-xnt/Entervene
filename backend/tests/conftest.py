import os

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/entervene_test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-with-at-least-32-characters")
os.environ.setdefault("COOKIE_SECURE", "false")
