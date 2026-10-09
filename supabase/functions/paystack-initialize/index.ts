// SmartLearn: authenticated server-side Paystack subscription checkout.
// Required Edge Function secrets: PAYSTACK_SECRET_KEY, PAYSTACK_PLAN_CODE.
// Uses Supabase's injected SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://nelsonudoffa.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const origin = req.headers.get("origin");
  if (origin && origin !== "https://nelsonudoffa.github.io") return json({ error: "Origin not allowed" }, 403);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Sign in to continue." }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
  const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const planCode = Deno.env.get("PAYSTACK_PLAN_CODE");
  if (!serviceKey || !paystackSecret || !planCode) return json({ error: "Payment service is not configured. Contact SmartLearn support." }, 503);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const token = authHeader.slice(7);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user || !user.email) return json({ error: "Your session is invalid. Sign in again." }, 401);

  const { data: existing } = await admin.from("smartlearn_entitlements").select("status,current_period_end").eq("user_id", user.id).maybeSingle();
  if (existing?.status === "active" && (!existing.current_period_end || new Date(existing.current_period_end) > new Date())) {
    return json({ error: "Your subscription is already active.", active: true }, 409);
  }

  const reference = "SL-" + crypto.randomUUID().replaceAll("-", "");
  const callbackUrl = "https://nelsonudoffa.github.io/Smartlearn/payment.html";
  const init = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: "Bearer " + paystackSecret, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      plan: planCode,
      reference,
      callback_url: callbackUrl,
      metadata: { smartlearn_user_id: user.id, product: "SmartLearn monthly access", custom_fields: [
        { display_name: "SmartLearn User ID", variable_name: "smartlearn_user_id", value: user.id }
      ] }
    })
  });
  const payload = await init.json();
  if (!init.ok || !payload.status || !payload.data?.authorization_url) {
    console.error("Paystack initialization failed", payload.message || init.status);
    return json({ error: "Could not start checkout. Please try again later." }, 502);
  }

  const { error: insertError } = await admin.from("smartlearn_payment_transactions").insert({
    reference, user_id: user.id, status: "pending"
  });
  if (insertError) {
    console.error("Could not record pending transaction", insertError.message);
    return json({ error: "Could not record your checkout. Please try again." }, 500);
  }
  return json({ authorization_url: payload.data.authorization_url, reference });
});
