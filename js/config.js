// ============================================================
// VERTEXT PAY — Config
// Replace placeholders after setting Netlify env vars
// ============================================================

// These will be injected at build time via Netlify environment variables
// or you can replace them directly here for local dev

window.VERTEXT_CONFIG = {
  // Your Supabase project URL — from Supabase Dashboard > Settings > API
  SUPABASE_URL: window.__ENV__?.SUPABASE_URL || "YOUR_SUPABASE_URL",

  // Supabase anon/public key (safe to expose)
  SUPABASE_ANON_KEY: window.__ENV__?.SUPABASE_ANON_KEY || "YOUR_SUPABASE_ANON_KEY",

  // Paystack PUBLIC key (safe to expose — used for popup initialization)
  PAYSTACK_PUBLIC_KEY: window.__ENV__?.PAYSTACK_PUBLIC_KEY || "YOUR_PAYSTACK_PUBLIC_KEY",

  // App settings
  APP_NAME: "Vertext Pay",
  CURRENCY: "USD",
  CURRENCY_SYMBOL: "$",
  MIN_DEPOSIT: 1.00,
  MIN_WITHDRAWAL: 1.00,
};

// Supabase CDN client — loaded from CDN in HTML
// Available globally as `window.supabase`
