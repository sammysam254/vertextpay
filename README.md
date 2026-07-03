# Vertext Pay

> ⚡ Lightning-fast digital wallet powered by Paystack + Supabase

A lightweight, zero-framework web app for depositing and withdrawing money through an in-app wallet.

---

## Project Structure

```
vertext-pay/
├── index.html          ← Landing page
├── auth.html           ← Sign in / Sign up
├── dashboard.html      ← Main wallet dashboard
├── css/
│   └── styles.css      ← Complete design system
├── js/
│   ├── config.js       ← App configuration
│   ├── utils.js        ← Shared utilities
│   ├── auth.js         ← Auth page logic
│   └── dashboard.js    ← Dashboard logic (deposit, withdraw, etc.)
├── assets/
│   └── logo.png
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   └── 001_schema.sql      ← Full DB schema
│   └── functions/
│       ├── verify-deposit/     ← Verifies Paystack payment + credits wallet
│       ├── initiate-withdrawal/← Paystack Transfers + debits wallet
│       ├── paystack-webhook/   ← Handles transfer.success/failed events
│       └── list-banks/         ← Lists Paystack-supported banks
├── netlify.toml        ← Netlify config with security headers
└── .env.example        ← Environment variables template
```

---

## Setup Guide

### 1. Supabase Setup

1. Go to [supabase.com](https://supabase.com) and create a new project
2. In the SQL Editor, run `supabase/migrations/001_schema.sql`
3. In your Supabase dashboard, go to **Settings > API** and copy:
   - `Project URL`
   - `anon public` key
4. Deploy edge functions (requires [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy verify-deposit
   supabase functions deploy initiate-withdrawal
   supabase functions deploy paystack-webhook
   supabase functions deploy list-banks
   ```
5. Set edge function secrets:
   ```bash
   supabase secrets set PAYSTACK_SECRET_KEY=sk_live_xxxxx
   supabase secrets set PAYSTACK_WEBHOOK_SECRET=your_webhook_secret
   ```

### 2. Paystack Setup

1. Log in to [Paystack Dashboard](https://dashboard.paystack.com)
2. Go to **Settings > API Keys & Webhooks**
3. Copy your **Public Key** and **Secret Key**
4. Add a webhook URL: `https://YOUR_SUPABASE_PROJECT.supabase.co/functions/v1/paystack-webhook`
5. Enable the following webhook events:
   - `transfer.success`
   - `transfer.failed`
   - `transfer.reversed`
   - `charge.success`

### 3. Add API Keys to Netlify

Go to **Netlify Dashboard > Your Site > Site Configuration > Environment Variables** and add:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon key |
| `PAYSTACK_PUBLIC_KEY` | Your Paystack public key |

> **Note**: The Paystack SECRET key should ONLY be set in Supabase Edge Function secrets (see step 1.5). Never put it in Netlify.

### 4. Update js/config.js

In `js/config.js`, replace the placeholder values with your actual keys:

```js
window.VERTEXT_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  PAYSTACK_PUBLIC_KEY: "pk_live_...",
  // ...
};
```

### 5. Deploy to Netlify

Option A — Drag & Drop:
- Go to [netlify.com/drop](https://app.netlify.com/drop) and drag the entire `vertext pay` folder

Option B — GitHub:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/vertext-pay.git
git push -u origin main
```
Then connect the GitHub repo in Netlify.

---

## How It Works

### Deposit Flow
1. User clicks "Deposit" → enters amount
2. Paystack popup opens (loaded from Paystack CDN)
3. User pays with card/bank transfer
4. On success, frontend calls `/functions/v1/verify-deposit` edge function
5. Edge function calls `api.paystack.co/transaction/verify/:ref`
6. If verified: wallet balance is credited, transaction recorded
7. Realtime subscription updates the UI balance instantly

### Withdrawal Flow
1. User clicks "Withdraw" → selects saved bank account + amount
2. Frontend calls `/functions/v1/initiate-withdrawal` edge function
3. Edge function:
   - Checks wallet balance ≥ withdrawal amount
   - Creates Paystack Transfer Recipient (if not already exists)
   - Initiates Paystack Transfer
   - Debits wallet, records transaction as "pending"
4. Paystack webhook (`/functions/v1/paystack-webhook`) receives:
   - `transfer.success` → marks transaction as "success"
   - `transfer.failed` → refunds wallet, marks as "failed"

---

## Security

- **Paystack Secret Key** never touches the browser — only in Supabase Edge Functions
- **HMAC verification** on every incoming webhook (SHA-512)
- **Row Level Security** on all Supabase tables — users can only see their own data
- **Service Role** used only in edge functions, not exposed to frontend
- **CSP headers** in `netlify.toml` prevent XSS and unauthorized scripts
- **Payment email verification** — prevents one user from claiming another's deposit

---

## Testing with Paystack Test Mode

Use Paystack test keys (`pk_test_...` / `sk_test_...`) and test cards:

| Card | Number |
|---|---|
| Success | 4084 0840 8408 4081 |
| Decline | 4084 0840 8408 4082 |

CVV: any 3 digits, Expiry: any future date, PIN: 0000
