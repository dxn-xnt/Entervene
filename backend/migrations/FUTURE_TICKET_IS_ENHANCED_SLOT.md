# TASK-409: Dedicated `is_enhanced_slot` Column on `period_template_slot` Table

## Status: TRACKED / PLANNED SCHEMA ENHANCEMENT

### Objective
Currently, `PeriodTemplateSlot` differentiates standard 45-min class periods from 60-min enhanced periods via `slot_name LIKE 'Enhanced%'` and duration. To make this 100% immune to administrator renaming of the text label in the UI, an explicit boolean flag should be introduced.

### Proposed Schema Changes
```python
# app/models/academic/PeriodTemplateSlot.py
is_enhanced_slot: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

### Alembic Migration Steps
1. Add column `is_enhanced_slot` (BOOLEAN DEFAULT FALSE).
2. Execute data migration:
   ```sql
   UPDATE period_template_slot 
   SET is_enhanced_slot = TRUE 
   WHERE LOWER(slot_name) LIKE '%enhanced%';
   ```
3. Update `BreakConfigDrawer.tsx` to expose an explicit checkbox for "Enhanced Period".
4. Update `AutoSchedulerService.py` to filter `s.is_enhanced_slot == True`.
