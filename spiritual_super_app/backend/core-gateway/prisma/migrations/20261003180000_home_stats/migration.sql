-- Homepage statistics singleton: the figures shown on the five stat cards, edited from the admin panel.

CREATE TABLE "home_stats" (
    "id" VARCHAR(32) NOT NULL,
    "happy_users" INTEGER NOT NULL,
    "verified_experts" INTEGER NOT NULL,
    "pujas_performed" INTEGER NOT NULL,
    "authentic_products" INTEGER NOT NULL,
    "user_rating" DECIMAL(2,1) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "home_stats_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "home_stats_counts_non_negative" CHECK (
        "happy_users" >= 0 AND "verified_experts" >= 0 AND "pujas_performed" >= 0 AND "authentic_products" >= 0
    ),
    CONSTRAINT "home_stats_rating_range" CHECK ("user_rating" >= 0 AND "user_rating" <= 5)
);

INSERT INTO "home_stats" ("id", "happy_users", "verified_experts", "pujas_performed", "authentic_products", "user_rating", "updated_at")
VALUES ('default', 50000, 500, 10000, 1000, 4.8, CURRENT_TIMESTAMP);
