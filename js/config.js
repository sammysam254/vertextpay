// ============================================================
// VERTEXT PAY — Config
// Replace placeholders after setting Netlify env vars
// ============================================================

// These will be injected at build time via Netlify environment variables
// or you can replace them directly here for local dev

window.VERTEXT_CONFIG = {
  // Supabase project
  SUPABASE_URL: "https://pjoajdnhvswrkehomwrd.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqb2FqZG5odnN3cmtlaG9td3JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwODIzMzAsImV4cCI6MjA5ODY1ODMzMH0.NSABkr7iiHL_2vT-Zm5_8TLL4N2XykM9g3yXcLUN-M8",

  // Paystack PUBLIC key (safe to expose — used only to open the payment popup)
  PAYSTACK_PUBLIC_KEY: "pk_live_558e1ed8114c63c09b135b1523443ecfffb60524",

  // App settings — KES (Kenyan Shillings, matches your Paystack account)
  APP_NAME: "Vertext Pay",
  CURRENCY: "KES",
  CURRENCY_SYMBOL: "KSh ",
  MIN_DEPOSIT: 0.01,
  MIN_WITHDRAWAL: 100,
};

// Supabase CDN client — loaded from CDN in HTML
// Available globally as `window.supabase`
