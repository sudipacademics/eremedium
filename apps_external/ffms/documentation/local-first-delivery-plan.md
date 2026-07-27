# Local-first delivery plan

RFMS will be completed as a fully working local system before any regulated or paid provider is connected. External services are adapters only; no user-facing workflow may depend on a provider stub to appear complete.

## Local completion gate

Every module must pass these checks locally with seeded data and a real database:

1. A user can create, view, edit and transition the entity through its allowed states.
2. All required fields validate on client and server.
3. Role and territory restrictions deny unauthorized actions.
4. Every critical transition writes an audit-log entry.
5. Tables, detail pages, filters, empty states, errors and confirmations work.
6. Critical workflows have automated API and browser tests.

## Implementation order before integrations

1. Laravel/Sanctum users, roles, permissions, sessions and audit middleware.
2. CRM leads, applicant records and the complete application wizard with saved drafts.
3. Document records and manual verification workflow using local private storage.
4. West Bengal territories, reservations, conflict prevention and manager assignment.
5. Video KYC appointments and manual review workflow using a local demo session state.
6. Agreements, payments, receipts, invoices and training as local state machines.
7. Applicant, Officer and Franchisee portals connected to the API, not browser-only data.
8. Notifications, support tickets, reports, exports and end-to-end tests.
9. Only then: OTP, Razorpay/Cashfree, OCR, Maps, Video KYC, eSign, storage and messaging adapters.

## Non-negotiable rules

- A frontend success message never represents a confirmed payment, document approval, eSign, OTP verification or KYC outcome.
- Provider callbacks will later update the same local state machines; they will not create parallel workflows.
- No provider credential is required until its local workflow has tests and a complete approval path.
