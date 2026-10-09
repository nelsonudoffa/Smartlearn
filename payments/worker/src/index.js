const json = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
});

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "https://nelsonudoffa.github.io";
  if (origin !== allowed) return null;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function verifyStudent(request, env) {
  if (!env.AUTH_JWKS_URL || !env.AUTH_ISSUER || !env.AUTH_AUDIENCE) return null;
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 12000) return null;

  try {
    const header = decodeJsonPart(parts[0]);
    const claims = decodeJsonPart(parts[1]);
    if (!["ES256", "RS256"].includes(header.alg) || !header.kid) return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== "number" || claims.exp <= now) return null;
    if (typeof claims.nbf === "number" && claims.nbf > now + 30) return null;
    if (claims.iss !== env.AUTH_ISSUER) return null;
    const aud = claims.aud;
    if (!(aud === env.AUTH_AUDIENCE || (Array.isArray(aud) && aud.includes(env.AUTH_AUDIENCE)))) return null;
    if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !claims.email) return null;

    const jwksResponse = await fetch(env.AUTH_JWKS_URL, { headers: { "Accept": "application/json" } });
    if (!jwksResponse.ok) return null;
    const jwks = await jwksResponse.json();
    const jwk = Array.isArray(jwks.keys) ? jwks.keys.find(k => k.kid === header.kid && (!k.alg || k.alg === header.alg)) : null;
    if (!jwk) return null;
    const algorithm = header.alg === "ES256"
      ? { name: "ECDSA", namedCurve: "P-256" }
      : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const key = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
    const verifyAlgorithm = header.alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
    const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const valid = await crypto.subtle.verify(verifyAlgorithm, key, decodeBase64Url(parts[2]), signed);
    if (!valid) return null;
    return { id: claims.sub, email: claims.email.toLowerCase() };
  } catch {
    return null;
  }
}

async function paystackFetch(path, env, body) {
  const response = await fetch("https://api.paystack.co" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Authorization": "Bearer " + env.PAYSTACK_SECRET_KEY,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok || !data.status) throw new Error("Paystack request failed");
  return data.data;
}

async function validSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const hex = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hex.length; i++) mismatch |= hex.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  return mismatch === 0;
}

export default {
  async fetch(request, env) {
    const corsHeaders = cors(request, env);
    if (!corsHeaders) return json({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({
          ok: true,
          paymentsConfigured: Boolean(env.PAYSTACK_SECRET_KEY && env.PAYSTACK_PLAN_CODE && env.DB),
          authenticationConfigured: Boolean(env.AUTH_JWKS_URL && env.AUTH_ISSUER && env.AUTH_AUDIENCE)
        }, 200, corsHeaders);
      }

      if (url.pathname === "/api/checkout" && request.method === "POST") {
        if (!env.PAYSTACK_SECRET_KEY || !env.PAYSTACK_PLAN_CODE || !env.DB) return json({ error: "Payment service is not configured" }, 503, corsHeaders);
        const student = await verifyStudent(request, env);
        if (!student) return json({ error: "Valid student sign-in is required." }, 401, corsHeaders);
        const customerEmail = student.email;
        const reference = "sl_" + crypto.randomUUID().replaceAll("-", "");
        const tx = await paystackFetch("/transaction/initialize", env, {
          email: customerEmail,
          plan: env.PAYSTACK_PLAN_CODE,
          reference,
          callback_url: env.PAYSTACK_CALLBACK_URL || "https://nelsonudoffa.github.io/Smartlearn/#payment-return",
          metadata: { smartlearn_student_id: student.id, product: "SmartLearn Premium", billing_interval: "monthly" }
        });
        await env.DB.prepare("INSERT INTO payment_events (event_id,event_type,reference,student_id,email,amount_kobo,currency,status,payload_json) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind("init_" + reference, "checkout.initialized", reference, student.id, customerEmail, 100000, "NGN", "pending", JSON.stringify({ authorization_url: tx.authorization_url }))
          .run();
        return json({ authorization_url: tx.authorization_url, reference }, 200, corsHeaders);
      }

      if (url.pathname === "/api/paystack-webhook" && request.method === "POST") {
        if (!env.PAYSTACK_SECRET_KEY || !env.DB) return json({ error: "Webhook service is not configured" }, 503, corsHeaders);
        const rawBody = await request.text();
        const signature = request.headers.get("x-paystack-signature") || "";
        if (!await validSignature(rawBody, signature, env.PAYSTACK_SECRET_KEY)) return json({ error: "Invalid signature" }, 401, corsHeaders);
        const event = JSON.parse(rawBody);
        const eventId = String(event?.data?.id || event?.data?.reference || crypto.randomUUID());
        const reference = event?.data?.reference ? String(event.data.reference) : null;
        const existing = await env.DB.prepare("SELECT id FROM payment_events WHERE event_id = ?").bind("webhook_" + eventId).first();
        if (existing) return json({ received: true, duplicate: true }, 200, corsHeaders);

        let verified = null;
        if (event.event === "charge.success" && reference) {
          verified = await paystackFetch("/transaction/verify/" + encodeURIComponent(reference), env);
        }
        const amountOk = verified && verified.status === "success" && Number(verified.amount) === 100000 && verified.currency === "NGN";
        const metaStudentId = verified?.metadata?.smartlearn_student_id;
        const email = verified?.customer?.email ? String(verified.customer.email).toLowerCase() : null;
        let status = "ignored";

        if (event.event === "charge.success" && amountOk && metaStudentId && email) {
          const pending = await env.DB.prepare("SELECT student_id,email,status FROM payment_events WHERE reference = ? AND event_type = 'checkout.initialized' ORDER BY id DESC LIMIT 1").bind(reference).first();
          if (pending && pending.student_id === metaStudentId && String(pending.email).toLowerCase() === email) {
            // Identity and reference must match the authenticated checkout recorded before redirect.
            // Activation period handling is intentionally not automatic until renewal/cancellation
            // events and provider subscription IDs are fully mapped and tested.
            status = "verified_pending_subscription_activation";
          } else {
            status = "verified_but_unmatched_checkout";
          }
        } else if (event.event === "invoice.payment_failed" || event.event === "subscription.disable" || event.event === "subscription.not_renew") {
          status = "subscription_event_received";
        }
        await env.DB.prepare("INSERT INTO payment_events (event_id,event_type,reference,student_id,email,amount_kobo,currency,status,payload_json) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind("webhook_" + eventId, String(event.event || "unknown"), reference, metaStudentId || null, email, verified?.amount ?? event?.data?.amount ?? null, verified?.currency ?? event?.data?.currency ?? null, status, JSON.stringify({ event: event.event, reference }))
          .run();
        return json({ received: true }, 200, corsHeaders);
      }

      if (url.pathname === "/api/me/subscription" && request.method === "GET") {
        const student = await verifyStudent(request, env);
        if (!student) return json({ error: "Valid student sign-in is required." }, 401, corsHeaders);
        if (!env.DB) return json({ error: "Database is not configured" }, 503, corsHeaders);
        const row = await env.DB.prepare("SELECT status, current_period_end, plan_code FROM subscriptions WHERE student_id = ?").bind(student.id).first();
        const active = Boolean(row && row.status === "active" && row.current_period_end && row.current_period_end > new Date().toISOString());
        return json({ active, subscription: row || null }, 200, corsHeaders);
      }
      return json({ error: "Not found" }, 404, corsHeaders);
    } catch {
      return json({ error: "Payment service error" }, 500, corsHeaders);
    }
  }
};