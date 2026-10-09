(function () {
  const statusEl = document.getElementById("payStatus");
  const button = document.getElementById("subscribeBtn");
  const config = window.SMARTLEARN_SUPABASE;
  const sdk = window.supabase;
  if (!config || !sdk?.createClient) {
    statusEl.textContent = "Supabase configuration could not be loaded. Please try again later.";
    statusEl.className = "pay-status error";
    return;
  }
  const client = sdk.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const fnUrl = config.url + "/functions/v1/";
  async function session() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  }
  async function checkAccess(s) {
    const r = await fetch(fnUrl + "smartlearn-access", { headers: { apikey: config.publishableKey, Authorization: "Bearer " + s.access_token } });
    let d = {};
    try { d = await r.json(); } catch (_) {}
    if (!r.ok) {
      const err = new Error(
        r.status === 404
          ? "The SmartLearn access function is not deployed yet (HTTP 404). Deploy smartlearn-access in Supabase, then refresh this page."
          : r.status === 401
            ? "Your sign-in session has expired. Sign in again, then refresh this page."
            : "Supabase access check failed (HTTP " + r.status + "). " + (d.error || "Check the Edge Function deployment and secrets.")
      );
      err.status = r.status;
      throw err;
    }
    if (r.ok && d.active) {
      statusEl.textContent = "Your subscription is active. You can use SmartLearn on this device and any other device where you sign in.";
      statusEl.className = "pay-status success";
      button.textContent = "Subscription active";
      button.disabled = true;
      return true;
    }
    return false;
  }
  async function init() {
    try {
      const s = await session();
      if (!s) {
        statusEl.textContent = "Please sign in or create a SmartLearn account before subscribing.";
        button.disabled = true;
        return;
      }
      const active = await checkAccess(s);
      if (active) return;
      statusEl.textContent = "Signed in as " + s.user.email + ". Continue to Paystack to start your monthly subscription.";
      button.disabled = false;
    } catch (e) {
      statusEl.textContent = e.message || "Could not check account status. Check the Supabase Edge Function deployment.";
      statusEl.className = "pay-status error";
      // Do not let a visitor mistake a failed backend check for a working checkout.
      button.disabled = true;
    }
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    statusEl.textContent = "Preparing secure Paystack checkout…";
    statusEl.className = "pay-status";
    try {
      const s = await session();
      if (!s) throw new Error("Please sign in first.");
      const r = await fetch(fnUrl + "paystack-initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: config.publishableKey, Authorization: "Bearer " + s.access_token },
        body: JSON.stringify({})
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not start checkout.");
      if (!d.authorization_url) throw new Error("Paystack did not return a checkout link.");
      window.location.assign(d.authorization_url);
    } catch (e) {
      statusEl.textContent = e.message || "Checkout failed. Please try again.";
      statusEl.className = "pay-status error";
      button.disabled = false;
    }
  });
  // On return from Paystack, never trust the query-string reference. The webhook activates access.
  init();
  if (new URLSearchParams(location.search).has("reference")) {
    statusEl.textContent = "Payment submitted. SmartLearn is checking for Paystack's verified confirmation. Refresh this page in a moment.";
    statusEl.className = "pay-status";
    setTimeout(init, 2500);
  }
})();