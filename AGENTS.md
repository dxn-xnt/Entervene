# Entervene UI conventions

- Before changing an interface, inspect the existing shared component and a nearby working example. Reuse the component instead of recreating its markup.
- Use `TeacherEmptyState` for Teacher empty datasets, including empty wizard steps; use the corresponding Student or Admin empty-state component on those interfaces. Choose an icon, title, description, and action that fit the actual state. Keep loading and errors separate from empty data.
- Use RetroUI `Dialog` headers and footers for modals. Keep step counts in the header, actions in the footer, and consistent padding across steps. Leave room for borders and shadows inside scrollable areas.
- Use RetroUI `Button` variants for actions and keep icon-to-label spacing consistent. Use the shared `Alert` for inline errors and toasts for successful operations. Do not show the same error as both an alert and a toast.
- Preserve existing behavior while making visual changes. Run the frontend build and relevant lint checks, and visually inspect the affected states when a browser session is available.
