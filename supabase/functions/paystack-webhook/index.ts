// Paystack sends raw JSON. Verify x-paystack-signature over the exact raw body before parsing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const secret = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";

async function hmacSha512Hex(key: string, message: string) {
  const keyBytes = new TextEncoder().encode(key);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
const reply = (status = 200) => new Response(status === 200 ? "ok" : "invalid", { status });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405);
  if (!secret || !serviceKey || !supabaseUrl) return reply(503);
  const rawBody = await req.text();
  const supplied = req.headers.get("x-paystack-signature") || "";
  const expected = await hmacSha512Hex(secret, rawBody);
  if (!supplied || !safeEqual(supplied.toLowerCase(), expected)) return reply(401);

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return reply(400); }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const data = event.data || {};
  const customerCode = typeof data.customer === "object" ? data.customer?.customer_code : data.customer;
  const subscriptionCode = data.subscription?.subscription_code || data.subscription_code || null;
  const reference = data.reference || data.transaction?.reference || null;

  // First identify the account by the server-created checkout reference. Never trust user_id from a browser.
  let userId: string | null = null;
  if (reference) {
    const { data: tx } = await admin.from("smartlearn_payment_transactions").select("user_id").eq("reference", reference).maybeSingle();
    userId = tx?.user_id || null;
  }
  // Recurring charges may use new references; map those through the Paystack customer code stored on activation.
  if (!userId && customerCode) {
    const { data: ent } = await admin.from("smartlearn_entitlements").select("user_id").eq("paystack_customer_code", customerCode).maybeSingle();
    userId = ent?.user_id || null;
  }

  if (event.event === "charge.success") {
    // A successful charge must include a transaction reference and be a successful charge.
    if (!reference || data.status !== "success") return reply(200);
    const expectedPlan = Deno.env.get("PAYSTACK_PLAN_CODE") || "";
    const eventPlan = data.plan_object?.plan_code || data.plan?.plan_code || "";
    const { data: knownTx } = await admin.from("smartlearn_payment_transactions").select("user_id").eq("reference", reference).maybeSingle();
    // First checkout must match a server-created pending reference. Renewal charges must map
    // to a previously stored Paystack customer and the configured subscription plan.
    if (!knownTx && (!customerCode || !eventPlan || eventPlan !== expectedPlan)) return reply(200);
    if (!userId) {
      console.error("Verified Paystack charge could not be mapped to SmartLearn account", reference);
      return reply(200);
    }
    const amount = Number(data.amount);
    const currency = String(data.currency || "").toUpperCase();
    const planCode = data.plan_object?.plan_code || data.plan?.plan_code || Deno.env.get("PAYSTACK_PLAN_CODE") || null;
    const customer = typeof data.customer === "object" ? data.customer?.customer_code : customerCode;
    const { error: txError } = await admin.from("smartlearn_payment_transactions").upsert({
      reference, user_id: userId, status: "success", amount_kobo: Number.isFinite(amount) ? amount : null,
      currency: currency || null, paystack_customer_code: customer || null,
      paystack_subscription_code: subscriptionCode, updated_at: new Date().toISOString()
    });
    if (txError) { console.error("Transaction upsert failed", txError.message); return reply(500); }

    // Paystack's signed successful charge event is the activation signal.
    // Monthly access is revalidated from Paystack's subscription lifecycle events below.
    const { error: entError } = await admin.from("smartlearn_entitlements").upsert({
      user_id: userId, status: "active", provider: "paystack",
      paystack_customer_code: customer || null, paystack_subscription_code: subscriptionCode,
      paystack_plan_code: planCode, last_payment_reference: reference,
      updated_at: new Date().toISOString()
    });
    if (entError) { console.error("Entitlement activation failed", entError.message); return reply(500); }
  }

  if (event.event === "subscription.create" || event.event === "subscription.enable") {
    if (userId) {
      await admin.from("smartlearn_entitlements").upsert({
        user_id: userId, status: "active", provider: "paystack",
        paystack_customer_code: customerCode || null,
        paystack_subscription_code: subscriptionCode,
        paystack_plan_code: data.plan?.plan_code || Deno.env.get("PAYSTACK_PLAN_CODE") || null,
        updated_at: new Date().toISOString()
      });
    }
  }

  if (["subscription.disable", "subscription.not_renew", "invoice.payment_failed"].includes(event.event)) {
    if (userId) {
      await admin.from("smartlearn_entitlements").update({
        status: event.event === "invoice.payment_failed" ? "past_due" : "cancelled",
        updated_at: new Date().toISOString()
      }).eq("user_id", userId);
    }
  }
  return reply(200);
});
