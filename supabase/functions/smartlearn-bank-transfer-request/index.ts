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

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Please sign in first." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const adminEmail = Deno.env.get("PAYMENT_ADMIN_EMAIL") || "neltech777@gmail.com";
  if (!url || !serviceKey || !resendKey) return json({ error: "Payment notification service is not configured. Please contact SmartLearn support." }, 503);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = auth.slice(7);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) return json({ error: "Your session has expired. Please sign in again." }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  const amount = Number(body.amount);
  const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 100) : "";
  const senderName = typeof body.sender_name === "string" ? body.sender_name.trim().slice(0, 100) : "";
  const receiptUrl = typeof body.receipt_url === "string" ? body.receipt_url.trim().slice(0, 500) : null;
  if (amount !== 2500) return json({ error: "The monthly subscription amount is ₦2,500." }, 400);
  if (!reference || !senderName) return json({ error: "Enter the transfer reference and sender name." }, 400);
  if (receiptUrl && !/^https:\/\//i.test(receiptUrl)) return json({ error: "Receipt link must start with https://." }, 400);

  const { data: request, error: insertError } = await admin.from("smartlearn_bank_transfer_requests").insert({
    user_id: user.id,
    user_email: user.email || null,
    amount_ngn: amount,
    transfer_reference: reference,
    sender_name: senderName,
    receipt_url: receiptUrl,
    status: "pending",
  }).select("id,created_at").single();

  if (insertError) {
    if (insertError.code === "23505") return json({ error: "This transfer reference has already been submitted. If you need help, contact the administrator." }, 409);
    console.error("Could not save transfer request:", insertError.message);
    return json({ error: "Could not save the transfer request. Please try again later." }, 500);
  }

  const safe = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const emailHtml = `
    <h2>SmartLearn: OPay transfer awaiting approval</h2>
    <p>A student submitted a transfer request. This is not proof that funds have arrived; please verify your OPay account before approving.</p>
    <ul>
      <li><b>Amount:</b> ₦${amount.toLocaleString("en-NG")}</li>
      <li><b>Student email:</b> ${safe(user.email || "Not available")}</li>
      <li><b>Sender name:</b> ${safe(senderName)}</li>
      <li><b>Transfer reference:</b> ${safe(reference)}</li>
      <li><b>Request ID:</b> ${safe(request.id)}</li>
      <li><b>Receipt link:</b> ${receiptUrl ? safe(receiptUrl) : "Not provided"}</li>
      <li><b>Submitted:</b> ${safe(request.created_at)}</li>
    </ul>
    <p>To protect your account, do not approve until the transfer is visible in your OPay transaction history.</p>`;

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("PAYMENT_EMAIL_FROM") || "SmartLearn Payments <onboarding@resend.dev>",
      to: [adminEmail],
      subject: "SmartLearn: ₦2,500 OPay transfer needs review",
      html: emailHtml,
    }),
  });
  if (!emailResponse.ok) {
    const details = await emailResponse.text();
    console.error("Resend notification failed:", emailResponse.status, details);
    return json({ error: "Your request was saved, but the administrator email could not be sent. Please contact the administrator directly and quote request ID " + request.id + "." }, 502);
  }

  return json({ ok: true, request_id: request.id, status: "pending", message: "Transfer request saved and administrator notification sent." }, 201);
});
