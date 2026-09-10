// Creates a Razorpay order for a subscription plan.
//
// Two things this function is responsible for, both security relevant:
//   1. The amount is decided HERE, from the table below — never taken from
//      the request body, so the browser cannot buy a year for one rupee.
//   2. It records WHO is paying and WHAT for, in the order's `notes`.
//      Razorpay echoes notes back on the webhook, which is how
//      razorpay-webhook knows whose subscription to activate. The browser
//      never gets to assert that.
//
// Deploy WITH JWT verification (the default) — an anonymous caller has no
// user to attach the order to:
//   supabase functions deploy create-razorpay-order

// @ts-ignore - Deno remote imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Deno remote imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";

/** The single source of truth for pricing. Amounts are in paise. */
const PLANS: Record<string, { amount: number; plan_type: string }> = {
  "Professional:annual": { amount: 399900, plan_type: "professional_annual" },
  "Professional:monthly": { amount: 39900, plan_type: "professional_monthly" },
  "Testing Plan:monthly": { amount: 5000, plan_type: "testing_weekly" },
  "Testing Plan:annual": { amount: 5000, plan_type: "testing_weekly" },
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// @ts-ignore - Deno global
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---- Identify the caller -------------------------------------------
    // The order must be tied to a real user, or the webhook has nobody to
    // activate. The JWT is verified by the platform; we decode it here to
    // learn which user it belongs to.
    const authHeader = req.headers.get("Authorization") ?? "";
    // @ts-ignore - Deno global
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    // @ts-ignore - Deno global
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !anonKey) {
      return json({ error: "Server not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    const user = userData?.user;
    if (userError || !user) {
      return json({ error: "You must be signed in to start a subscription" }, 401);
    }

    // ---- Resolve the plan server-side ----------------------------------
    const body = await req.json();
    const planName = String(body?.planName ?? "");
    const isAnnual = !!body?.isAnnual;

    const plan = PLANS[`${planName}:${isAnnual ? "annual" : "monthly"}`];
    if (!plan) {
      console.error(`Invalid plan requested: ${planName} (annual=${isAnnual})`);
      return json({ error: "Invalid Plan Selected" }, 400);
    }

    // @ts-ignore - Deno global
    const key_id = Deno.env.get("RAZORPAY_KEY_ID");
    // @ts-ignore - Deno global
    const key_secret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!key_id || !key_secret) {
      return json({ error: "Razorpay server keys not configured" }, 500);
    }

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${key_id}:${key_secret}`)}`,
      },
      body: JSON.stringify({
        amount: plan.amount,
        currency: "INR",
        receipt: `sub_${user.id.slice(0, 8)}_${Date.now()}`,
        payment_capture: 1,
        // Comes back on the webhook. This is the trusted channel that tells
        // razorpay-webhook whose subscription to activate, and to what.
        notes: {
          user_id: user.id,
          plan_type: plan.plan_type,
        },
      }),
    });

    const orderData = await response.json();
    if (orderData.error) {
      console.error("Razorpay API error:", orderData.error);
      return json({ error: orderData.error.description || "Razorpay API Error" }, 502);
    }

    return json(
      {
        orderId: orderData.id,
        amount: plan.amount,
        currency: "INR",
        keyId: key_id,
      },
      200,
    );
  } catch (error: any) {
    console.error("create-razorpay-order failed:", error?.message);
    return json({ error: error?.message ?? "Unexpected error" }, 400);
  }
});
