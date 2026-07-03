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
    // ── Auth ───────────────────────────────────────────────────────────
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
    const { amount, bank_account_id } = await req.json();
    if (!amount || !bank_account_id) throw new Error("Missing amount or bank_account_id");

    const withdrawalAmount = Number(amount);
    if (withdrawalAmount < 1) throw new Error("Minimum withdrawal is $1.00");

    // ── Check wallet balance ───────────────────────────────────────────
    const { data: wallet, error: walletErr } = await supabase
      .from("wallets")
      .select("id, balance")
      .eq("user_id", user.id)
      .single();

    if (walletErr || !wallet) throw new Error("Wallet not found");
    if (Number(wallet.balance) < withdrawalAmount) {
      throw new Error(`Insufficient balance. Available: $${Number(wallet.balance).toFixed(2)}`);
    }

    // ── Get bank account ───────────────────────────────────────────────
    const { data: bankAccount, error: bankErr } = await supabase
      .from("bank_accounts")
      .select("*")
      .eq("id", bank_account_id)
      .eq("user_id", user.id)
      .single();

    if (bankErr || !bankAccount) throw new Error("Bank account not found");

    // ── Ensure Paystack recipient exists ───────────────────────────────
    let recipientCode = bankAccount.recipient_code;

    if (!recipientCode) {
      const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "nuban",
          name: bankAccount.account_name,
          account_number: bankAccount.account_number,
          bank_code: bankAccount.bank_code,
          currency: "USD",
        }),
      });

      const recipientData = await recipientRes.json();
      if (!recipientData.status) {
        throw new Error(`Failed to create transfer recipient: ${recipientData.message}`);
      }

      recipientCode = recipientData.data.recipient_code;

      // Save recipient code for future use
      await supabase
        .from("bank_accounts")
        .update({ recipient_code: recipientCode })
        .eq("id", bank_account_id);
    }

    // ── Generate reference ─────────────────────────────────────────────
    const reference = `VTX-WD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // ── Debit wallet first (reserve) ───────────────────────────────────
    const newBalance = Number(wallet.balance) - withdrawalAmount;
    const { error: debitErr } = await supabase
      .from("wallets")
      .update({ balance: newBalance })
      .eq("id", wallet.id);

    if (debitErr) throw new Error("Failed to debit wallet");

    // ── Create transaction record (pending) ────────────────────────────
    const { data: txn, error: txnErr } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        type: "withdrawal",
        amount: withdrawalAmount,
        status: "pending",
        reference,
        description: `Withdrawal to ${bankAccount.bank_name} ****${bankAccount.account_number.slice(-4)}`,
      })
      .select()
      .single();

    if (txnErr) {
      // Rollback wallet debit
      await supabase.from("wallets").update({ balance: wallet.balance }).eq("id", wallet.id);
      throw new Error("Failed to create transaction record");
    }

    // ── Initiate Paystack Transfer ─────────────────────────────────────
    const amountKobo = Math.round(withdrawalAmount * 100); // Paystack uses smallest currency unit

    const transferRes = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "balance",
        amount: amountKobo,
        recipient: recipientCode,
        reason: `Vertext Pay withdrawal — ${reference}`,
        reference,
        currency: "USD",
      }),
    });

    const transferData = await transferRes.json();

    if (!transferData.status) {
      // Rollback: restore wallet balance and mark transaction failed
      await supabase.from("wallets").update({ balance: wallet.balance }).eq("id", wallet.id);
      await supabase.from("transactions").update({ status: "failed" }).eq("id", txn.id);
      throw new Error(`Transfer failed: ${transferData.message}`);
    }

    // ── Save transfer code ─────────────────────────────────────────────
    await supabase
      .from("transactions")
      .update({ transfer_code: transferData.data.transfer_code })
      .eq("id", txn.id);

    return new Response(
      JSON.stringify({
        success: true,
        transfer_code: transferData.data.transfer_code,
        new_balance: newBalance,
        message: `$${withdrawalAmount.toFixed(2)} withdrawal initiated. Funds will arrive shortly.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err) {
    console.error("initiate-withdrawal error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
