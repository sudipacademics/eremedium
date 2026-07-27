# RFMS architecture

RFMS uses three independent Next.js clients: Marketing Web (public acquisition), Franchise Portal (applicant/franchisee self-service), and Admin Dashboard (internal operations). They communicate only with the versioned Laravel API at `/api/v1`. MySQL is the transactional source of truth and Redis handles queues, cache, rate limits and Horizon.

Business integrations are represented by adapter contracts; OTP, payment, storage, OCR, Video KYC, eSign and maps must never be called directly from domain workflows. Sensitive documents remain private and access is via short-lived signed URLs.

## Core invariants

- Final approval requires approved Video KYC.
- Go Live requires all mandatory training complete.
- Exclusive territory assignment checks for existing active allocations and requires an audited override.
- Payment status is set only by verified webhook or verified accounts reconciliation.
- OCR is assistive; a human reviewer decides document verification.
