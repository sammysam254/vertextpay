import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ── Auth: get calling user ─────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );

    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    // ── Parse body ─────────────────────────────────────────────────────
    const { reference } = await req.json();
    if (!reference) throw new Error("Missing payment reference");

    // ── Check if already processed ────────────────────────────────────
    const { data: existing } = await supabase
      .from("transactions")
      .select("id, status")
      .eq("reference", reference)
      .single();

    if (existing?.status === "success") {
      return new Response(
        JSON.stringify({ success: true, message: "Already verified", already_done: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Verify with Paystack ───────────────────────────────────────────
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
          "Content-Type": "application/json",
        },
      }
    );

    const paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data?.status !== "success") {
      throw new Error(`Payment not successful: ${paystackData.message}`);
    }

    const paidAmountCents = paystackData.data.amount; // in cents (Ksh cents)
    const amountKES = paidAmountCents / 100;           // convert to Shillings

    // Ensure this payment belongs to this user (check metadata)
    const paidEmail = paystackData.data.customer?.email;
    if (paidEmail && paidEmail.toLowerCase() !== user.email?.toLowerCase()) {
      throw new Error("Payment email mismatch — unauthorized");
    }

    // ── Credit wallet (atomic) ─────────────────────────────────────────
    const { data: wallet, error: walletErr } = await supabase
      .from("wallets")
      .select("id, balance")
      .eq("user_id", user.id)
      .single();

    if (walletErr || !wallet) throw new Error("Wallet not found");

    const newBalance = Number(wallet.balance) + amountKES;

    const { error: updateErr } = await supabase
      .from("wallets")
      .update({ balance: newBalance })
      .eq("id", wallet.id);

    if (updateErr) throw new Error("Failed to update wallet");

    // ── Record transaction ─────────────────────────────────────────────
    const { error: txnErr } = await supabase
      .from("transactions")
      .upsert(
        {
          user_id: user.id,
          type: "deposit",
          amount: amountKES,
          status: "success",
          reference,
          description: `Deposit via Paystack`,
        },
        { onConflict: "reference" }
      );

    if (txnErr) console.error("Transaction record error:", txnErr);

    return new Response(
      JSON.stringify({
        success: true,
        amount: amountKES,
        new_balance: newBalance,
        message: `KSh ${amountKES.toFixed(2)} deposited successfully`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err) {
    console.error("verify-deposit error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
