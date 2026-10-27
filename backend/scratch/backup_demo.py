import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
os.environ["ENV_FILE"] = str(BACKEND_DIR / ".env.demo")

from app.core.Config import settings

db_url = urlparse(settings.database_url)
assert db_url.path == "/Entervene_Demo", f"Refusing to backup non-demo database: {db_url.path}"
assert db_url.hostname in ("localhost", "127.0.0.1"), f"Refusing remote host: {db_url.hostname}"

pg_dump_bin = Path(r"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe")
assert pg_dump_bin.exists(), f"pg_dump not found at {pg_dump_bin}"

timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup_dir = BACKEND_DIR / "backups"
backup_dir.mkdir(parents=True, exist_ok=True)
backup_file = backup_dir / f"entervene_demo_pre_reading_review_{timestamp}.dump"

env = os.environ.copy()
if db_url.password:
    env["PGPASSWORD"] = db_url.password

cmd = [
    str(pg_dump_bin),
    "-Fc",
    "-h", db_url.hostname or "localhost",
    "-p", str(db_url.port or 5432),
    "-U", db_url.username or "postgres",
    "-d", "Entervene_Demo",
    "-f", str(backup_file),
]

print(f"Creating backup of Entervene_Demo to {backup_file.name}...")
res = subprocess.run(cmd, env=env, capture_output=True, text=True)
if res.returncode != 0:
    print("pg_dump failed:", res.stderr)
    sys.exit(1)

size = backup_file.stat().st_size
print(f"Backup created successfully! Size: {size} bytes")

# Validate the backup using pg_restore --list
pg_restore_bin = Path(r"C:\Program Files\PostgreSQL\18\bin\pg_restore.exe")
res_list = subprocess.run([str(pg_restore_bin), "--list", str(backup_file)], capture_output=True, text=True)
if res_list.returncode != 0:
    print("pg_restore --list validation failed:", res_list.stderr)
    sys.exit(1)

line_count = len(res_list.stdout.strip().splitlines())
print(f"Backup validated successfully with pg_restore --list! Contains {line_count} TOC entries.")
