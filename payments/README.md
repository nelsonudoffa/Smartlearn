# SmartLearn Paystack backend setup

Price target: NGN 1,000 per month. The static GitHub Pages site cannot safely verify payment or act as an authentication system by itself.

## Important security boundary

Do not enable premium content until student identity is authenticated server-side. A display name, browser localStorage value, email typed into a form, callback URL, or a client-supplied "paid" flag is not proof of identity or payment. The payment ledger must be linked to a stable authenticated student ID, and the backend must enforce entitlement checks for protected content.

## 1. Create the monthly plan in Paystack

1. Sign in at https://dashboard.paystack.com/
2. Open Plans and create a plan named **SmartLearn Premium**.
3. Set the amount to **NGN 1,000** and interval to **Monthly**.
4. Save the plan and copy its plan code.
5. Use Paystack test mode first. Confirm recurring payments are enabled for your account and payment method.

Paystack subscriptions use a plan code and send subscription/charge events. See https://paystack.com/docs/payments/subscriptions/

## 2. Create Cloudflare resources

1. Create a Cloudflare Worker for the payment API.
2. Create a D1 database named `smartlearn-payments`.
3. Apply `payments/schema.sql` to that D1 database.
4. Bind the D1 database to the Worker with binding name `DB`.
5. Add encrypted Worker secrets in Cloudflare Settings > Variables and Secrets:
   - `PAYSTACK_SECRET_KEY` — Paystack test secret key first; production secret only after tests.
6. Add a non-secret variable `PAYSTACK_PLAN_CODE` with the plan code from Paystack.
7. Never commit secret keys to this repository or paste them into chat.

Cloudflare secret documentation: https://developers.cloudflare.com/workers/configuration/secrets/
Cloudflare D1 documentation: https://developers.cloudflare.com/d1/get-started/

## 3. Required API behavior before production

Implement and test these server-side routes:
- `POST /api/checkout`: requires authenticated student identity, initializes the Paystack transaction using the fixed plan code, and saves a pending reference tied to the authenticated student ID. Do not trust amount, plan, student ID, or return URL from the browser.
- `POST /api/paystack-webhook`: validate `x-paystack-signature` using HMAC-SHA512 over the exact raw request body and `PAYSTACK_SECRET_KEY`; reject invalid signatures. Process events idempotently using a unique event/reference. Confirm transaction status, amount (100000 kobo), currency (NGN), plan, and customer details before recording payment.
- `GET /api/me/subscription`: requires the same authenticated identity and returns only that student's current subscription.
- A protected content/API layer must enforce active subscription expiry on the server. Hiding buttons in the browser is not access control.

Paystack webhook guidance: https://paystack.com/docs/payments/webhooks/
Transaction verification: https://paystack.com/docs/payments/verify-payments/

## 4. Monthly renewal and expiry

Do not assume the first successful payment grants permanent access. Process renewal success and failed/cancelled subscription events, update the current period end from verified provider data, and deny access after expiry. Make event handling idempotent because a webhook can be delivered more than once.

## 5. Test checklist

- Test checkout uses NGN and the configured plan, never a browser-supplied price.
- Successful test payment activates only the authenticated student who initiated it.
- Failed, abandoned, underpaid, wrong-currency, or invalid-signature events do not activate access.
- Duplicate webhook delivery does not duplicate or extend entitlement.
- A student cannot inspect another student's subscription by changing an email or ID.
- Expired/cancelled subscriptions lose premium access.
- Test mode passes before switching to live credentials.

## Current status

This folder documents the database schema and deployment requirements. It is not a deployed payment processor. Do not advertise automatic unlocking until the authenticated checkout, webhook verification, subscription-status API, protected content enforcement, and end-to-end tests are implemented and deployed.