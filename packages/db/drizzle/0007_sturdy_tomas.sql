CREATE TABLE "drizzle_sql_migrations" (
	"tag" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);