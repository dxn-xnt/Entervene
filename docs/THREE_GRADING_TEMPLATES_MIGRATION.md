# Canonical grading templates: development migration

This is a **practice configuration** for the local Entervene development database. It is not an official school or DepEd policy. Confirm production thresholds and weights with the client before production use.

## Approved configuration

| Template | Passing threshold | Written Work | Performance Tasks | Exams | Subjects |
| --- | ---: | ---: | ---: | ---: | ---: |
| Core (ID 1) | 87% | 20% | 50% | 30% | 28 |
| Applied (ID 10) | 85% | 20% | 60% | 20% | 1 |
| Specialized (ID 8) | 85% | 20% | 50% | 30% | 11 |

The Applied exam weight was corrected to 20% with the user's approval so the three weights total 100%.

## Development database migration

The target was confirmed as `localhost:5432/Entervene`. A verified custom-format backup was saved at `backend/backups/pre_three_templates_20261018_005426.dump` (SHA-256 `58738041941082789c65f4655f4c111563914625f86862208bc1f99113772d8c`). The backup is ignored by Git. Migration `20261018_three_grading_templates` was first run successfully on a disposable database restored from this backup and then on the target database.

| Record or structure | Before | After |
| --- | ---: | ---: |
| Grading templates | 12 | 3 |
| Grading components | 36 | 9 |
| Subject groups | 6 | Table removed |
| Subjects | 40 | 40 |
| Subject offerings | 94 | 94 |
| Subject loads | 147 | 147 |
| Classwork | 8 | 8 |
| Student submissions | 2 | 2 |

The nine removed template IDs are 2, 3, 4, 7, 9, 11, 12, 13, and 14. The migration replaces the subject group and string template columns with a required `subject.grading_template_id` foreign key. Science Research IDs 53 and 46, and French 9 ID 47 map to Specialized; Filipino 7 ID 1 maps to Core. The recorded Mathematics 7 submission retains grade `9.00` (submission ID 8). Core edits are locked while that graded submission exists; Applied and Specialized can be edited when they have no recorded grades. The subject, offering, and load counts remained intact.

Core, Applied, and Specialized are the initial canonical templates created by the migration. The later administrator workflow permits additional templates through the same `grading_template` and `subject.grading_template_id` architecture. It does not restore Subject Groups or a second threshold source.

## Rollback

This is a data consolidation, so the migration intentionally refuses `alembic downgrade`. Restore the verified PostgreSQL backup as a whole if rollback is required. Stop application writes first, restore into a **new** database, verify counts and Alembic revision there, then point the application at that database. Do not run an in-place downgrade or merge old template rows into the new schema.
