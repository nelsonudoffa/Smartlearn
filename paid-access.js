(function () {
  const config = window.SMARTLEARN_SUPABASE;
  const sdk = window.supabase;
  const path = location.pathname.toLowerCase();
  const protectedPage = /\/(waec|neco|past-questions|practice-questions)\.html$/.test(path);
  const isHome = path.endsWith("/") || path.endsWith("/index.html");
  const homePractice = isHome ? document.getElementById("practice") : null;
  const protectedLinks = [...document.querySelectorAll('a[href="./waec.html"],a[href="./neco.html"],a[href="./past-questions.html"],a[href="./practice-questions.html"]')];

  function gate(message, signedIn) {
    if (protectedPage) {
      document.body.innerHTML = '<header class="topbar"><a class="brand" href="./index.html"><span class="brand-mark">S</span> SmartLearn</a></header><main class="section" style="max-width:720px"><section class="panel"><p class="eyebrow">SMARTLEARN PREMIUM</p><h1>Subscription required</h1><p>' + message + '</p><p>Subscribe once and use the same account on your phone, tablet or computer.</p><div class="hero-actions">' + (signedIn ? '<a class="btn primary" href="./payment.html">Subscribe with Paystack</a>' : '<a class="btn primary" href="./auth.html">Sign in / Create account</a>') + '<a class="btn secondary" href="./index.html">Back to home</a></div></section></main>';
    } else {
      if (homePractice) {
        homePractice.innerHTML = '<div class="panel"><p class="eyebrow">SMARTLEARN PREMIUM</p><h2>Practice exams</h2><p>' + message + '</p><a class="btn primary" href="' + (signedIn ? './payment.html' : './auth.html') + '">' + (signedIn ? 'Subscribe with Paystack' : 'Sign in / Create account') + '</a></div>';
      }
      protectedLinks.forEach(a => { a.href = signedIn ? "./payment.html" : "./auth.html"; a.textContent = a.textContent.trim() + " 🔒"; });
    }
    document.documentElement.classList.remove("paid-access-pending");
    document.body.style.visibility = "visible";
  }
  function reveal() {
    document.documentElement.classList.remove("paid-access-pending");
    document.body.style.visibility = "visible";
  }
  async function run() {
    if (!config || !sdk?.createClient) {
      if (protectedPage) gate("Secure subscription checking is not configured yet. Please try again later.", false);
      else { if (homePractice) homePractice.hidden = true; reveal(); }
      return;
    }
    const client = sdk.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const session = data.session;
      if (!session) {
        if (protectedPage) gate("Please sign in and activate your monthly subscription to open this section.", false);
        else { if (homePractice) gate("Sign in and activate your monthly subscription to use practice exams.", false); else { protectedLinks.forEach(a => { a.href="./auth.html"; a.textContent=a.textContent.trim()+" 🔒"; }); reveal(); } }
        return;
      }
      const response = await fetch(config.url + "/functions/v1/smartlearn-access", {
        headers: { apikey: config.publishableKey, Authorization: "Bearer " + session.access_token }
      });
      if (!response.ok) throw new Error("Access check failed");
      const access = await response.json();
      if (access.active) { reveal(); return; }
      if (protectedPage) gate("Your account does not have an active paid subscription. Subscribe through Paystack; access will activate after payment is verified.", true);
      else { if (homePractice) gate("An active monthly subscription is required to use practice exams.", true); else { protectedLinks.forEach(a => { a.href="./payment.html"; a.textContent=a.textContent.trim()+" 🔒"; }); reveal(); } }
    } catch (e) {
      if (protectedPage) gate("We could not verify your subscription. Please try again when the connection is available.", true);
      else { if (homePractice) homePractice.hidden = true; reveal(); }
    }
  }
  if (protectedPage) {
    document.documentElement.classList.add("paid-access-pending");
    const style = document.createElement("style");
    style.textContent = "html.paid-access-pending body{visibility:hidden}";
    document.head.appendChild(style);
  }
  run();
})();