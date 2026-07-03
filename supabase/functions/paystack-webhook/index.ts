import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-paystack-signature, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function verifySignature(body: string, signature: string): Promise<boolean> {
  const secret = Deno.env.get("PAYSTACK_WEBHOOK_SECRET")!;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hexSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hexSig === signature;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const signature = req.headers.get("x-paystack-signature") || "";
    const body = await req.text();

    // Verify webhook authenticity
    const isValid = await verifySignature(body, signature);
    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }

    const event = JSON.parse(body);
    console.log("Paystack webhook event:", event.event);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Handle transfer events ─────────────────────────────────────────
    if (event.event === "transfer.success") {
      const reference = event.data.reference;
      await supabase
        .from("transactions")
        .update({ status: "success" })
        .eq("reference", reference)
        .eq("type", "withdrawal");

      console.log("Transfer success recorded:", reference);
    }

    if (event.event === "transfer.failed" || event.event === "transfer.reversed") {
      const reference = event.data.reference;

      // Get the transaction
      const { data: txn } = await supabase
        .from("transactions")
        .select("user_id, amount")
        .eq("reference", reference)
        .eq("type", "withdrawal")
        .single();

      if (txn) {
        // Refund wallet
        const { data: wallet } = await supabase
          .from("wallets")
          .select("id, balance")
          .eq("user_id", txn.user_id)
          .single();

        if (wallet) {
          await supabase
            .from("wallets")
            .update({ balance: Number(wallet.balance) + Number(txn.amount) })
            .eq("id", wallet.id);
        }
      }

      await supabase
        .from("transactions")
        .update({ status: "failed" })
        .eq("reference", reference)
        .eq("type", "withdrawal");

      console.log("Transfer failed, wallet refunded:", reference);
    }

    // ── Handle charge/deposit events ──────────────────────────────────
    if (event.event === "charge.success") {
      const reference = event.data.reference;
      console.log("Charge success webhook received (verify-deposit handles this):", reference);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
