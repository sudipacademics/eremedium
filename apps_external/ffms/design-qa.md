# Applicant Dashboard Design QA

## Comparison target

- Source visual truth: `C:\Users\USER\AppData\Local\Temp\codex-clipboard-71d4de07-9a8d-41db-86ee-a7e8479fab99.png`
- Implementation: in-app Browser capture of `http://localhost:3001/` (authenticated applicant overview; browser-rendered capture attached during this QA run)
- Viewport: 1920 x 990 desktop; 390 x 844 mobile checked for responsive layout
- State: application `RFMS-2026-0002`, signed-in applicant overview

## Comparison history

1. Initial rendered comparison found that the dashboard content column was too narrow and the hero banner was too tall versus the reference.
   - Fix: increased the dashboard content frame and reduced hero headline scale and progress-card padding in `apps/franchise-portal/app/portal.css`.
2. Rebuilt and captured the revised desktop overview at the reference viewport.
   - Result: sidebar, application top bar, hero, progress card and paired overview cards now match the reference hierarchy, proportions and spacing.

## Fidelity review

- Fonts and typography: DM Sans and Manrope preserve the reference's clean dashboard hierarchy, heavy hero heading and compact navigation labels.
- Spacing and layout rhythm: fixed left rail, slim top bar, centered content frame, two-column overview cards and mobile stacking match the intended dashboard structure.
- Colors and visual tokens: navy sidebar, blue-to-teal hero, pale slate workspace, blue selected navigation and restrained card borders follow the reference palette.
- Image quality and asset fidelity: the existing Remedium Lab logo is retained in the sidebar instead of the reference's generic `R` mark so branding remains consistent with the rest of RFMS.
- Copy and content: applicant name, registration number, territory, KYC count, payment progress and team information come from the signed-in application where available.

## Checks

- Page identity: passed — signed-in profile loads at `http://localhost:3001/`.
- Blank or framework error state: passed.
- Console health: passed — no warnings or errors reported.
- Navigation: passed — Documents opens the KYC document module; Overview returns to the dashboard overview.
- Responsive layout: passed — sidebar navigation switches to a two-column mobile menu without horizontal overflow.

## Focused comparison evidence

- Sidebar: navigation items, selected Overview state and lower help card are present and proportioned to the source.
- Main overview: welcome banner, progress indicator, next actions and franchise-team card are visible above the fold.
- Intentional deviation: the dashboard uses the real Remedium logo and live application data rather than the generic sample logo, applicant and manager shown in the reference.

## Findings

No actionable P0, P1 or P2 differences remain for the requested dashboard layout.

## Follow-up polish

- P3: assigned franchise manager name and meeting details can be made admin-configurable when that workflow is added.

final result: passed
