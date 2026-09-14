import os
import re

app_dir = r"c:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene\backend\app"
results = []

for root, _, files in os.walk(app_dir):
    for f in files:
        if f.endswith(".py"):
            path = os.path.join(root, f)
            with open(path, "r", encoding="utf-8", errors="ignore") as fp:
                lines = fp.readlines()
            for idx, line in enumerate(lines):
                if "SubjectLoad" in line and ("query" in line or "filter" in line):
                    # Find query block start
                    start_idx = idx
                    while start_idx > 0 and "db.query" not in lines[start_idx]:
                        if idx - start_idx > 5:
                            break
                        start_idx -= 1
                    if "db.query" in lines[start_idx]:
                        end_idx = min(len(lines), start_idx + 25)
                        snippet = "".join(lines[start_idx:end_idx])
                        results.append((os.path.relpath(path, app_dir), start_idx + 1, snippet))

# Deduplicate by (relpath, line_number)
deduped = {}
for r in results:
    key = (r[0], r[1])
    if key not in deduped:
        deduped[key] = r[2]

print(f"Total distinct SubjectLoad query sites inspected: {len(deduped)}")
print("=" * 80)

classified_live = []
classified_draft = []
classified_historical_or_all = []
classified_other = []

for (rel, lno), snip in sorted(deduped.items()):
    is_active = "is_active_version" in snip
    is_draft = 'status == "draft"' in snip or "status == 'draft'" in snip
    
    if is_active:
        classified_live.append((rel, lno, snip))
    elif is_draft:
        classified_draft.append((rel, lno, snip))
    elif "TeacherSubstitution" in snip or "SubjectLoadAssignmentLog" in snip:
        classified_historical_or_all.append((rel, lno, snip))
    else:
        classified_other.append((rel, lno, snip))

print(f"1. LIVE / CURRENT CONFIGURATION ({len(classified_live)} sites):")
for rel, lno, _ in classified_live:
    print(f"   - {rel}:{lno}")

print(f"\n2. DRAFT / SECTION STAGING ({len(classified_draft)} sites):")
for rel, lno, _ in classified_draft:
    print(f"   - {rel}:{lno}")

print(f"\n3. HISTORICAL / AUDIT / JOINS ({len(classified_historical_or_all)} sites):")
for rel, lno, _ in classified_historical_or_all:
    print(f"   - {rel}:{lno}")

print(f"\n4. OTHER / PERIOD-WIDE RAW ({len(classified_other)} sites):")
for rel, lno, snip in classified_other:
    first_few = snip.strip().splitlines()[:3]
    print(f"   - {rel}:{lno} -> {' '.join(first_few)}")
