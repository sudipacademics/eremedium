# Backend foundation — started

The Laravel 12 project skeleton now lives in `apps/api`. The API is versioned at `/api/v1`; its health endpoint returns a standard response envelope. The initial database migration establishes roles, permissions, role-permission assignments and immutable audit-log fields.

The Docker image uses PHP 8.3 and Composer. Run `docker compose up --build` on a machine with Docker Desktop, then run migrations inside the API container once database credentials are configured.

Next backend increment: Sanctum authentication, OTP challenge persistence, user/role models, audit middleware, and authentication endpoints.
