(function () {
  const statusEl = document.getElementById("payStatus");
  const form = document.getElementById("transferForm");
  const button = document.getElementById("submitTransferBtn");
  const config = window.SMARTLEARN_SUPABASE;
  const sdk = window.supabase;
  if (!config || !sdk?.createClient) {
    statusEl.textContent = "Supabase configuration could not be loaded. Please try again later.";
    statusEl.className = "pay-status error";
    button.disabled = true;
    return;
  }
  const client = sdk.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  async function init() {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        statusEl.textContent = "Please sign in or create a SmartLearn account before submitting a transfer.";
        statusEl.className = "pay-status error";
        button.disabled = true;
        return;
      }
      statusEl.textContent = "Signed in as " + data.session.user.email + ". Transfer ₦2,500 to the OPay account above, then submit your transfer details for administrator approval.";
      statusEl.className = "pay-status";
      button.disabled = false;
    } catch (_) {
      statusEl.textContent = "Could not check your account. Refresh this page and try again.";
      statusEl.className = "pay-status error";
      button.disabled = true;
    }
  }
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    button.disabled = true;
    statusEl.textContent = "Submitting your transfer for review…";
    statusEl.className = "pay-status";
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const s = data.session;
      if (!s) throw new Error("Please sign in first.");
      const payload = {
        amount: Number(document.getElementById("transferAmount").value),
        reference: document.getElementById("transferReference").value.trim(),
        sender_name: document.getElementById("transferSender").value.trim(),
        receipt_url: document.getElementById("transferReceipt").value.trim() || null
      };
      if (payload.amount !== 2500) throw new Error("Enter the exact monthly fee of ₦2,500.");
      const response = await fetch(config.url + "/functions/v1/smartlearn-bank-transfer-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: config.publishableKey, Authorization: "Bearer " + s.access_token },
        body: JSON.stringify(payload)
      });
      let result = {};
      try { result = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(result.error || (response.status === 404 ? "The bank-transfer approval service has not been deployed yet. Your request was not sent. Please contact the SmartLearn administrator." : "Could not submit transfer details (HTTP " + response.status + ")."));
      statusEl.textContent = "Your transfer details have been submitted. Your SmartLearn access will remain locked until the administrator confirms receipt and approves the request.";
      statusEl.className = "pay-status success";
      form.reset();
      document.getElementById("transferAmount").value = "2500";
    } catch (err) {
      statusEl.textContent = err.message || "Could not submit your transfer. Please try again.";
      statusEl.className = "pay-status error";
    } finally {
      button.disabled = false;
    }
  });
  init();
})();