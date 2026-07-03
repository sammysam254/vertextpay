// ============================================================
// VERTEXT PAY — Authentication Logic
// ============================================================

let supabaseClient;

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.VERTEXT_CONFIG;

  // Initialize Supabase client
  supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Redirect to dashboard if already logged in
  await redirectIfAuth(supabaseClient);

  // ── Tab switching ──────────────────────────────────────────
  const tabs = document.querySelectorAll('.auth-tab');
  const forms = document.querySelectorAll('.auth-form');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      forms.forEach(f => f.classList.toggle('hidden', f.id !== `${target}-form`));
      tab.classList.add('active');
    });
  });

  // ── Sign Up ────────────────────────────────────────────────
  const signupForm = document.getElementById('signup-form');
  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = signupForm.querySelector('[type=submit]');
    setButtonLoading(btn, true);

    const name  = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const pass  = document.getElementById('signup-password').value;
    const confirmPass = document.getElementById('signup-confirm').value;

    if (pass !== confirmPass) {
      showToast('Passwords do not match', 'error');
      setButtonLoading(btn, false);
      return;
    }

    if (pass.length < 8) {
      showToast('Password must be at least 8 characters', 'error');
      setButtonLoading(btn, false);
      return;
    }

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password: pass,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/dashboard.html`,
      }
    });

    if (error) {
      showToast(error.message, 'error');
    } else if (data.user && !data.session) {
      showAlert('signup-alert', 'Check your email to confirm your account!', 'info');
    } else {
      showToast('Account created!', 'success');
      window.location.href = '/dashboard.html';
    }

    setButtonLoading(btn, false);
  });

  // ── Sign In ────────────────────────────────────────────────
  const loginForm = document.getElementById('login-form');
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = loginForm.querySelector('[type=submit]');
    setButtonLoading(btn, true);

    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });

    if (error) {
      showToast(error.message, 'error');
    } else {
      window.location.href = '/dashboard.html';
    }

    setButtonLoading(btn, false);
  });

  // ── Password visibility toggle ────────────────────────────
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const isText = input.type === 'text';
      input.type = isText ? 'password' : 'text';
      btn.textContent = isText ? '👁' : '🙈';
    });
  });
});

function showAlert(id, message, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = message;
  el.classList.remove('hidden');
}
