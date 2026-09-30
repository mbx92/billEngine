ALTER TABLE "plans" DROP CONSTRAINT "plans_price_amount_check";--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_price_amount_check" CHECK ("plans"."price_amount" >= 0);