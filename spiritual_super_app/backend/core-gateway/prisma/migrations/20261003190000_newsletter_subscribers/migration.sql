-- Homepage "Stay Connected" sign-ups. Emails are stored lower-cased, so the unique index de-duplicates them.

CREATE TABLE "newsletter_subscribers" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");
CREATE INDEX "newsletter_subscribers_created_at_idx" ON "newsletter_subscribers"("created_at");
