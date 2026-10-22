# Passing-policy administration (PR 1b)

After applying migration `20261022_passing_policy_audit`, an administrator must configure the general-average passing grade for each academic year. Nothing is initialized by the migration. In **Admin → System Settings → General Average Passing Grade**, select the year, provide an audit reason, and check the confirmation box:

- If a validated legacy value is shown, explicitly confirm that proposal.
- If no validated legacy value exists, enter a value from 0 to 100 with at most two decimal places and choose **Set initial passing grade manually**.
- For a later year, **Copy from Previous Academic Year** explicitly copies the immediately preceding year's configured value. Review it before confirming.

The value applies only to the selected year. Until configured, general-average policy resolution raises a configuration error; it never silently uses the legacy value, another year, or the active year. Subject thresholds continue to resolve from assigned grading templates.

Template passing-threshold changes use the separate audited action in **Admin → Subjects → Grading**. Because a template can be shared across academic years, any finalized period grade for a currently assigned subject blocks its threshold edit, including historical, inactive, and archived offerings. The action does not change components, weights, assignments, or stored grades. Future closure snapshots may allow a narrower historical policy; PR 1b does not implement them.

Both policy actions record the actor, academic year, old and new values, reason, timestamp, and revision in the same transaction as the change. Stale versions are rejected. Close School Year, calendar protection, and academic-input freezing remain separate PRs and are not enabled here.
