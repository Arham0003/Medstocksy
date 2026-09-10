// Razorpay webhook — the ONLY thing allowed to activate a subscription.
//
// Why this exists: the client used to write `subscriptions` itself right
// after checkout. RLS has no INSERT/UPDATE policy on that table, so the
// write was rejected and paying customers were left inactive. Even if a
// policy were added, trusting the browser to declare "I paid" is not
// something we can verify.
//
// Here the payment is confirmed by Razorpay signing the request body with a
// secret only Razorpay and this function know. Nothing else can forge it.
//
// Deploy WITHOUT JWT verification — Razorpay is not a logged-in user:
//   supabase functions deploy razorpay-webhook --no-verify-jwt
//
// Required secrets:
//   RAZORPAY_WEBHOOK_SECRET   (Razorpay Dashboard -> Settings -> Webhooks)
//   SUPABASE_URL              (injected by the platform)
//   SUPABASE_SERVICE_ROLE_KEY (injected by the platform)

// @ts-ignore - Deno remote imports
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Deno remote imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

/** Plans we are willing to activate, and how long each grants. */
const PLAN_DAYS: Record<string, number> = {
  professional_annual: 365,
  professional_monthly: 30,
  testing_weekly: 7,
};

/** Hex-encode raw bytes. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string compare.
 *
 * A plain `===` leaks how many leading characters matched through timing,
 * which is enough to reconstruct a signature byte by byte.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256 of the RAW body, hex encoded — how Razorpay signs webhooks. */
async function computeSignature(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
}

// @ts-ignore - Deno global
serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // @ts-ignore - Deno global
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  // @ts-ignore - Deno global
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  // @ts-ignore - Deno global
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!secret || !supabaseUrl || !serviceKey) {
    // Fail closed and loudly: a misconfigured webhook must never look "ok"
    // to Razorpay, or it will stop retrying and payments go unactivated.
    console.error("razorpay-webhook: missing required environment secrets");
    return new Response("Server misconfigured", { status: 500 });
  }

  // The signature covers the exact bytes sent. Re-serialising the parsed
  // JSON would change key order/spacing and never match.
  const rawBody = await req.text();
  const provided = req.headers.get("x-razorpay-signature") ?? "";

  const expected = await computeSignature(rawBody, secret);
  if (!provided || !timingSafeEqual(provided, expected)) {
    console.warn("razorpay-webhook: signature mismatch, rejecting");
    return new Response("Invalid signature", { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Malformed JSON", { status: 400 });
  }

  // Only these two mean "money actually arrived".
  const eventType: string = event?.event ?? "";
  if (eventType !== "payment.captured" && eventType !== "order.paid") {
    // 200 so Razorpay stops retrying an event we simply do not act on.
    return new Response(JSON.stringify({ ignored: eventType }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payment = event?.payload?.payment?.entity ?? {};
  const order = event?.payload?.order?.entity ?? {};

  // Notes were attached by create-razorpay-order, which derived them from
  // our own price table — so they are our data coming back, not the
  // browser's claim.
  const notes = { ...(order.notes ?? {}), ...(payment.notes ?? {}) };
  const userId: string | undefined = notes.user_id;
  const planType: string | undefined = notes.plan_type;

  if (!userId || !planType || !(planType in PLAN_DAYS)) {
    console.error("razorpay-webhook: unusable notes", { userId, planType });
    // 200: retrying will not fix missing notes, and we do not want Razorpay
    // hammering a payment we cannot map. Surfaced in logs for manual repair.
    return new Response(JSON.stringify({ error: "unmappable payment" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const paymentId: string | null = payment.id ?? null;
  const orderId: string | null = order.id ?? payment.order_id ?? null;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotency: Razorpay retries, and may send both payment.captured and
  // order.paid for the same payment. Applying twice would double the term.
  if (paymentId) {
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("razorpay_payment_id", paymentId)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ status: "already applied" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Renewals extend from the unused remainder rather than truncating it.
  const { data: current } = await supabase
    .from("subscriptions")
    .select("current_period_end, status")
    .eq("user_id", userId)
    .maybeSingle();

  const now = new Date();
  const existingEnd = current?.current_period_end ? new Date(current.current_period_end) : null;
  const startFrom = existingEnd && existingEnd > now && current?.status === "active" ? existingEnd : now;
  const periodEnd = new Date(startFrom.getTime() + PLAN_DAYS[planType] * 86_400_000);

  const { error } = await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      plan_type: planType,
      status: "active",
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("razorpay-webhook: activation failed", error.message);
    // 500 so Razorpay retries — a transient DB error must not lose a payment.
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`razorpay-webhook: activated ${planType} for ${userId} until ${periodEnd.toISOString()}`);
  return new Response(JSON.stringify({ status: "activated", plan: planType }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
