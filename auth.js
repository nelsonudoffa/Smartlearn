(function () {
  const statusEl = document.getElementById("authStatus");
  const form = document.getElementById("authForm");
  const emailEl = document.getElementById("authEmail");
  const passwordEl = document.getElementById("authPassword");
  const signUpBtn = document.getElementById("signUpBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  const signInBtn = document.getElementById("signInBtn");

  function status(message) {
    if (statusEl) statusEl.textContent = message;
  }

  const config = window.SMARTLEARN_SUPABASE;
  const sdk = window.supabase;
  if (!config || !config.url || !config.publishableKey || config.publishableKey === "PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE" || !sdk || !sdk.createClient) {
    status("Supabase setup is not complete yet. Add your public publishable key in auth-config.js and reload this page.");
    if (form) form.addEventListener("submit", e => e.preventDefault());
    if (signUpBtn) signUpBtn.addEventListener("click", () => status("Add the Supabase publishable key in auth-config.js first."));
    return;
  }

  const client = sdk.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  function setSignedIn(user) {
    const signedIn = Boolean(user);
    if (signOutBtn) signOutBtn.hidden = !signedIn;
    if (signInBtn) signInBtn.hidden = signedIn;
    if (signUpBtn) signUpBtn.hidden = signedIn;
    if (passwordEl) passwordEl.value = "";
    if (signedIn) {
      status("Signed in as " + (user.email || "student") + ". Secure identity is ready; paid access is not enabled until payment activation is completed.");
    } else {
      status("You are signed out. Sign in or create a student account.");
    }
  }

  client.auth.getSession().then(({ data, error }) => {
    if (error) status("Could not check your session. Please reload and try again.");
    else setSignedIn(data.session && data.session.user);
  });

  client.auth.onAuthStateChange((_event, session) => setSignedIn(session && session.user));

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const email = emailEl.value.trim().toLowerCase();
    const password = passwordEl.value;
    signInBtn.disabled = true;
    status("Signing in…");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    signInBtn.disabled = false;
    if (error) {
      status(error.message || "Sign-in failed. Check your details and try again.");
      return;
    }
    setSignedIn(data.user);
  });

  signUpBtn.addEventListener("click", async () => {
    const email = emailEl.value.trim().toLowerCase();
    const password = passwordEl.value;
    if (!email || password.length < 8) {
      status("Enter a valid email and a password of at least 8 characters.");
      return;
    }
    signUpBtn.disabled = true;
    status("Creating your account…");
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: "https://nelsonudoffa.github.io/Smartlearn/#login" }
    });
    signUpBtn.disabled = false;
    if (error) {
      status(error.message || "Could not create the account. Please try again.");
      return;
    }
    if (data.session && data.user) {
      setSignedIn(data.user);
    } else {
      status("Account created. Check your email for the confirmation link, then return here to sign in.");
    }
  });

  signOutBtn.addEventListener("click", async () => {
    const { error } = await client.auth.signOut();
    if (error) status("Sign-out failed. Please try again.");
    else setSignedIn(null);
  });

  // Expose only a narrow helper for future authenticated Worker API calls.
  window.smartLearnAuth = {
    async getAccessToken() {
      const { data, error } = await client.auth.getSession();
      if (error || !data.session) return null;
      return data.session.access_token;
    },
    async getUser() {
      const { data, error } = await client.auth.getUser();
      return error ? null : data.user;
    }
  };
})();
