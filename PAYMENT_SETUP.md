# SmartLearn monthly paid access setup

This repository contains the first implementation of a Paystack monthly subscription flow:
- SQL schema for entitlements and payment records
- Authenticated Edge Function to start Paystack checkout
- Public Paystack webhook that verifies HMAC-SHA512 signatures before processing events
- Authenticated endpoint to check a signed-in user's entitlement
- Checkout page and a browser-side access gate for WAEC, NECO, past-question resources and practice exam pages

## Important limitation before going live

GitHub Pages is a static host. The browser-side gate is a navigation deterrent, **not complete content security**: current WAEC/NECO and practice-question HTML embeds question banks in public HTML/JavaScript. Anyone who knows a file URL can still fetch that source directly. Do not advertise this as fully secure paid content yet.

For actual protection, migrate question-bank data and private downloadable resources out of public HTML/JS into Supabase tables/storage with restrictive Row Level Security, or return them only from an Edge Function after checking the authenticated user's active entitlement. Public third-party resource links also cannot be made private by a SmartLearn paywall. This follow-on migration is required before claiming the question content itself is protected.

## 1. Set the monthly price in Paystack
1. Sign in to your Paystack Dashboard.
2. Create a plan named SmartLearn Monthly Access.
3. Set interval to monthly, currency to NGN, and choose your price.
4. Copy the plan code (usually starts with PLN_). This is PAYSTACK_PLAN_CODE.
5. Complete Paystack business activation required for live payments. Use test keys and a test plan first.

The checkout uses your Paystack plan code, so the amount is not hard-coded in the website.

## 2. Apply the database migration
1. Open the Supabase project: https://supabase.com/dashboard/project/ktdrtgndvftlyakbavna
2. Open SQL Editor and create a new query.
3. Copy and run supabase/migrations/202610090001_paid_access.sql.
4. Confirm smartlearn_entitlements and smartlearn_payment_transactions exist under Table Editor.

The migration lets users read only their own entitlement. Payment and entitlement writes are reserved for server-side functions.

## 3. Add Edge Function secrets
Open Supabase Dashboard → Edge Functions → Secrets and add:
- PAYSTACK_SECRET_KEY — Paystack secret key, test key for initial testing; never commit it to GitHub or put it in browser JavaScript.
- PAYSTACK_PLAN_CODE — your monthly plan code, e.g. PLN_... .
- Supabase Edge Functions normally provide project URL and service-role credentials. If your runtime does not provide SUPABASE_SERVICE_ROLE_KEY, add the service-role/secret key as SUPABASE_SERVICE_ROLE_KEY in Edge Function secrets. Keep it server-side only.

Never paste secret keys into ChatGPT, GitHub files, auth-config.js, or any public page.

## 4. Deploy the three Supabase Edge Functions
Source files:
- supabase/functions/paystack-initialize/index.ts
- supabase/functions/paystack-webhook/index.ts
- supabase/functions/smartlearn-access/index.ts

Deploy to project ktdrtgndvftlyakbavna using Supabase CLI or the Dashboard's supported deployment flow. The repository includes supabase/config.toml; make sure paystack-webhook has JWT verification disabled because Paystack does not send a Supabase user token. The webhook still authenticates events by verifying x-paystack-signature. The other two functions must require authentication.

Typical CLI commands from a local computer with Supabase CLI installed:

    supabase login
    supabase link --project-ref ktdrtgndvftlyakbavna
    supabase functions deploy paystack-initialize
    supabase functions deploy smartlearn-access
    supabase functions deploy paystack-webhook --no-verify-jwt

Set secrets in the Dashboard or CLI; never commit a .env containing real keys.

## 5. Configure the Paystack webhook
In Paystack Dashboard, open Settings → API Keys & Webhooks (the label may vary) and set webhook URL to:

https://ktdrtgndvftlyakbavna.supabase.co/functions/v1/paystack-webhook

Ensure delivery of charge.success, subscription.create, subscription.enable, subscription.disable, subscription.not_renew, and invoice.payment_failed where available. Event names can vary by lifecycle; test renewals and cancellation in test mode. The handler validates the signature using your secret key.

## 6. Test before live launch
1. Use Paystack test secret key and a test monthly plan.
2. Create a new SmartLearn account and confirm email if enabled.
3. Open https://nelsonudoffa.github.io/Smartlearn/payment.html, sign in, and start checkout.
4. Complete a Paystack test payment.
5. Confirm the webhook delivery succeeds in Paystack, then check that the user's row in smartlearn_entitlements becomes active.
6. Sign in with the same account on another device and verify the entitlement is active.
7. Test cancellation/failed renewal and confirm access is removed or marked past due.
8. Only after tests pass, switch secrets and plan code to live values.

## 7. Price and subscription lifecycle
The website intentionally does not choose a price for you. Set your NGN monthly price in the Paystack plan and store its plan code in Supabase secrets. Paystack manages recurring charges; SmartLearn reacts to signed webhook events. Before live launch, verify lifecycle events against your actual Paystack test payloads and complete the private-content migration described above.

## Reference URLs
- Paystack subscriptions: https://paystack.com/docs/payments/subscriptions/
- Paystack webhook signature validation: https://paystack.com/docs/payments/webhooks/
- Supabase Edge Function secrets: https://supabase.com/docs/guides/functions/secrets
- Supabase data security / RLS: https://supabase.com/docs/guides/database/secure-data