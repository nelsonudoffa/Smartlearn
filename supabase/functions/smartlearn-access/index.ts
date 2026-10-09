import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://nelsonudoffa.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (req.headers.get("origin") && req.headers.get("origin") !== "https://nelsonudoffa.github.io") return json({ error: "Origin not allowed" }, 403);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ active: false, reason: "sign_in_required" }, 401);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
  if (!serviceKey) return json({ error: "Access service is not configured." }, 503);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });
  const { data: { user }, error } = await admin.auth.getUser(auth.slice(7));
  if (error || !user) return json({ active: false, reason: "sign_in_required" }, 401);
  const { data, error: queryError } = await admin.from("smartlearn_entitlements").select("status,current_period_end").eq("user_id", user.id).maybeSingle();
  if (queryError) return json({ error: "Could not check subscription status." }, 500);
  const active = data?.status === "active" && (!data.current_period_end || new Date(data.current_period_end) > new Date());
  return json({ active, status: data?.status || "inactive", current_period_end: data?.current_period_end || null });
});
