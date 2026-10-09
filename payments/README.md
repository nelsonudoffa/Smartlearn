# SmartLearn payments and authentication setup

Price target: NGN 1,000 per month. The static GitHub Pages site cannot safely verify payment or act as an authentication system by itself.

## Security status

The Worker now includes signature verification for Supabase JWTs using the project's JWKS endpoint and validates signature, expiry, issuer, audience, subject, and email. Checkout still requires a valid signed-in student token. This is not a complete live subscription system: webhook activation, renewals/cancellations, and protected lesson delivery must be implemented and tested before collecting real payments.

## 1. Create Supabase Auth project

1. Open https://supabase.com/dashboard and create a project for SmartLearn.
2. Save the database password securely; do not send it in chat or commit it to GitHub. SmartLearn uses Supabase Auth for identity; Cloudflare D1 remains the payment ledger.
3. In Project Settings > API (or API Keys), copy the Project URL and the publishable/anon key. The publishable/anon key is intended for browser use; never use a service-role/secret key in the browser.
4. In Authentication > URL Configuration, set Site URL to https://nelsonudoffa.github.io/Smartlearn/ and add that URL to Redirect URLs.
5. In Authentication > Providers, enable Email. Choose email confirmation settings suitable for your launch, and test the confirmation link on the hosted site.
6. The Project URL is https://YOUR_PROJECT_REF.supabase.co. Do not guess the project ref; copy it from the dashboard.

## 2. Configure Cloudflare Worker identity variables

In Cloudflare Dashboard > Workers & Pages > smartlearn-payments > Settings > Variables and Secrets, add these non-secret variables (replace YOUR_PROJECT_REF with the actual Supabase project ref):

- AUTH_JWKS_URL = https://YOUR_PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json
- AUTH_ISSUER = https://YOUR_PROJECT_REF.supabase.co/auth/v1
- AUTH_AUDIENCE = authenticated

Keep PAYSTACK_SECRET_KEY as an encrypted secret, not a plain variable. Keep PAYSTACK_PLAN_CODE as the plan code already in wrangler.jsonc. Save and deploy the Worker after changing settings.

The Worker validates Supabase JWT signatures using the JWKS key ID and supports ES256 and RS256. If your project is configured with a signing method that does not publish a compatible public key, select/configure a supported asymmetric signing key in Supabase or the Worker will reject tokens.

## 3. Configure D1

1. Create a D1 database named smartlearn-payments.
2. Execute payments/schema.sql in the D1 console.
3. Bind the database to the Worker using binding name DB.
4. The database ID must match the ID in payments/worker/wrangler.jsonc.

## 4. Deploy and check health

Deploy payments/worker/src/index.js with payments/worker/wrangler.jsonc using Wrangler or the Cloudflare dashboard. If deploying from a local clone, run from the repository root:

    npx wrangler deploy --config payments/worker/wrangler.jsonc

Make sure the Worker project root and entry point match the config. If Wrangler prompts for login, run npx wrangler login first.

Open https://YOUR_WORKER_SUBDOMAIN.workers.dev/api/health and check that authenticationConfigured and paymentsConfigured are true. A healthy endpoint only confirms configuration presence, not end-to-end payment readiness.

## 5. Frontend Supabase client

Use Supabase's publishable/anon key only in the public browser client. Sign-in should retrieve the current session access token and send it as Authorization: Bearer <access_token> to the Worker. Never trust a browser-supplied student ID; the Worker derives the identity from the verified token.

Before adding the frontend integration, obtain the real Supabase Project URL and publishable/anon key. Never paste a service-role key into the site or repository.

## 6. Paystack routes and live-readiness

- POST /api/checkout requires a valid Supabase token and initializes Paystack with the fixed monthly plan code.
- POST /api/paystack-webhook validates the Paystack HMAC signature and verifies successful transactions against Paystack.
- GET /api/me/subscription requires a valid Supabase token and returns only that user's subscription record.

The current webhook intentionally does not activate a subscription automatically yet. Renewal, failed-payment, cancellation, and expiry handling must be implemented and tested. Premium lessons must be delivered through an authenticated backend/API; hiding a button on GitHub Pages does not protect public lesson files.

## 7. Test checklist before production

- Confirm signup, email confirmation, sign-in, sign-out, and session refresh.
- Invalid, expired, wrong-issuer, and wrong-audience JWTs are rejected.
- Checkout requires authentication and always uses the configured plan.
- Invalid Paystack signatures and failed/underpaid/wrong-currency transactions never grant access.
- Successful payments activate only the authenticated student linked to the pending checkout.
- Duplicate webhook delivery is idempotent.
- Renewal success extends access; failed/cancelled/expired subscriptions lose access.
- Students cannot read or modify another student's subscription.
- Test mode passes before switching to live credentials.

## Important secrets

Never commit Supabase service-role keys, Paystack secret keys, or any private credentials to GitHub. Do not send them in chat. Use Cloudflare encrypted Worker secrets for server-side secrets.