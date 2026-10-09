const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
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

async function verifyStudent(request, env) {
  // Secure-by-default: do not trust browser localStorage or a submitted student ID.
  // Configure a real identity provider and validate its JWT here before enabling checkout.
  // Until then, all student-specific endpoints intentionally fail closed.
  if (!env.AUTH_JWKS_URL || !env.AUTH_ISSUER || !env.AUTH_AUDIENCE) return null;
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  // JWT validation must be implemented for the chosen provider; never decode-only.
  // This scaffold refuses access rather than accepting an unverified token.
  return null;
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
        return new Response(JSON.stringify({ ok: true, paymentsConfigured: Boolean(env.PAYSTACK_SECRET_KEY && env.PAYSTACK_PLAN_CODE), authenticationConfigured: Boolean(env.AUTH_JWKS_URL && env.AUTH_ISSUER && env.AUTH_AUDIENCE) }), { headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" } });
      }

      if (url.pathname === "/api/checkout" && request.method === "POST") {
        if (!env.PAYSTACK_SECRET_KEY || !env.PAYSTACK_PLAN_CODE || !env.DB) return json({ error: "Payment service is not configured" }, 503);
        const student = await verifyStudent(request, env);
        if (!student) return json({ error: "Secure student sign-in is not configured yet. Checkout is disabled." }, 503);
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
        return new Response(JSON.stringify({ authorization_url: tx.authorization_url, reference }), { headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" } });
      }

      if (url.pathname === "/api/paystack-webhook" && request.method === "POST") {
        if (!env.PAYSTACK_SECRET_KEY || !env.DB) return json({ error: "Webhook service is not configured" }, 503);
        const rawBody = await request.text();
        const signature = request.headers.get("x-paystack-signature") || "";
        if (!await validSignature(rawBody, signature, env.PAYSTACK_SECRET_KEY)) return json({ error: "Invalid signature" }, 401);
        const event = JSON.parse(rawBody);
        const eventId = String(event?.data?.id || event?.data?.reference || crypto.randomUUID());
        const reference = event?.data?.reference ? String(event.data.reference) : null;
        const existing = await env.DB.prepare("SELECT id FROM payment_events WHERE event_id = ?").bind("webhook_" + eventId).first();
        if (existing) return json({ received: true, duplicate: true });

        // Never activate from an unsigned callback or a browser redirect.
        // Verify the transaction against Paystack before granting any entitlement.
        let verified = null;
        if (event.event === "charge.success" && reference) {
          verified = await paystackFetch("/transaction/verify/" + encodeURIComponent(reference), env);
        }
        const amountOk = verified && verified.status === "success" && Number(verified.amount) === 100000 && verified.currency === "NGN";
        const metaStudentId = verified?.metadata?.smartlearn_student_id;
        const email = verified?.customer?.email;
        let status = "ignored";
        if (event.event === "charge.success" && amountOk && metaStudentId && email) {
          // Fail closed: checkout is disabled until authenticated identity is implemented and this
          // student metadata is generated from the verified identity, never from client input.
          status = "verified_pending_identity";
        } else if (event.event === "invoice.payment_failed" || event.event === "subscription.disable" || event.event === "subscription.not_renew") {
          status = "subscription_event_received";
        }
        await env.DB.prepare("INSERT INTO payment_events (event_id,event_type,reference,email,amount_kobo,currency,status,payload_json) VALUES (?,?,?,?,?,?,?,?)")
          .bind("webhook_" + eventId, String(event.event || "unknown"), reference, email || null, verified?.amount ?? event?.data?.amount ?? null, verified?.currency ?? event?.data?.currency ?? null, status, JSON.stringify({ event: event.event, reference }))
          .run();
        return json({ received: true });
      }

      if (url.pathname === "/api/me/subscription" && request.method === "GET") {
        const student = await verifyStudent(request, env);
        if (!student) return json({ error: "Secure student sign-in is not configured yet." }, 503);
        const row = await env.DB.prepare("SELECT status, current_period_end, plan_code FROM subscriptions WHERE student_id = ?").bind(student.id).first();
        const active = Boolean(row && row.status === "active" && row.current_period_end && row.current_period_end > new Date().toISOString());
        return new Response(JSON.stringify({ active, subscription: row || null }), { headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" } });
      }
      return json({ error: "Not found" }, 404);
    } catch {
      return json({ error: "Payment service error" }, 500);
    }
  }
};