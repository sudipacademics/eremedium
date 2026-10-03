-- Staff roles stored in the database, an audit trail, in-app notifications, and the public
-- "Join as an Expert" application workflow. Phones in ADMIN_PHONES remain implicit Super Admins.

CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CONTENT_MANAGER', 'FINANCE_MANAGER', 'SUPPORT');

CREATE TYPE "ProviderCategory" AS ENUM ('ASTROLOGER', 'NUMEROLOGIST', 'VASTU_EXPERT', 'AYURVEDA_EXPERT', 'PANDIT', 'SPIRITUAL_GUIDE', 'OTHER');

CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'MORE_INFO_REQUESTED');

CREATE TYPE "JoinRequestFileKind" AS ENUM ('PHOTO', 'DOCUMENT');

ALTER TABLE "astrologers" ADD COLUMN "category" "ProviderCategory" NOT NULL DEFAULT 'ASTROLOGER';
CREATE INDEX "astrologers_category_idx" ON "astrologers"("category");

CREATE TABLE "staff_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role" "StaffRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "staff_members_user_id_key" ON "staff_members"("user_id");

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "actor_phone" VARCHAR(20),
    "actor_role" VARCHAR(32),
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" VARCHAR(120),
    "summary" VARCHAR(500) NOT NULL,
    "metadata" JSONB,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    -- Applicants may not have an account yet; their notices are matched by phone at sign-in.
    "phone" VARCHAR(20),
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "link" VARCHAR(300),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_recipient" CHECK ("user_id" IS NOT NULL OR "phone" IS NOT NULL)
);
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");
CREATE INDEX "notifications_phone_created_at_idx" ON "notifications"("phone", "created_at");

CREATE TABLE "provider_join_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_no" VARCHAR(24) NOT NULL,
    "user_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "category" "ProviderCategory" NOT NULL,
    "category_other" VARCHAR(80),
    "expertise" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "experience_years" SMALLINT NOT NULL,
    "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "qualification" VARCHAR(500) NOT NULL,
    "about" VARCHAR(3000) NOT NULL,
    "services" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "admin_note" VARCHAR(2000),
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "provider_astrologer_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_join_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provider_join_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "provider_join_requests_experience" CHECK ("experience_years" BETWEEN 0 AND 80)
);
CREATE UNIQUE INDEX "provider_join_requests_application_no_key" ON "provider_join_requests"("application_no");
CREATE INDEX "provider_join_requests_status_created_at_idx" ON "provider_join_requests"("status", "created_at");
CREATE INDEX "provider_join_requests_category_idx" ON "provider_join_requests"("category");
CREATE INDEX "provider_join_requests_phone_idx" ON "provider_join_requests"("phone");

CREATE TABLE "join_request_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "kind" "JoinRequestFileKind" NOT NULL,
    "label" VARCHAR(120),
    "original_name" VARCHAR(200) NOT NULL,
    "mime_type" VARCHAR(60) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "join_request_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "join_request_files_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "provider_join_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "join_request_files_request_id_idx" ON "join_request_files"("request_id");

CREATE TABLE "join_request_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "actor_user_id" UUID,
    -- APPLICANT, STAFF or SYSTEM
    "actor_kind" VARCHAR(16) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "from_status" "JoinRequestStatus",
    "to_status" "JoinRequestStatus",
    "note" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "join_request_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "join_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "provider_join_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "join_request_events_request_id_created_at_idx" ON "join_request_events"("request_id", "created_at");
