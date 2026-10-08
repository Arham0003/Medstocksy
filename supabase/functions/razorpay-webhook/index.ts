// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Razorpay sends payment.captured server-to-server regardless of what the
// browser does. This closes the gap where a user's tab closes after payment
// but before the browser handler fires — subscription was never recorded.
//
// Signature: HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET), hex-encoded,
// compared against the X-Razorpay-Signature header.
//
// record_subscription_payment is idempotent: same razorpay_payment_id
// returns { duplicate: true } without granting extra time.

console.log("Razorpay Webhook Function Invoked")

// Days per plan_type — the source of truth for how many days each plan grants.
const PLAN_TYPE_DAYS: Record<string, number> = {
    "testing_weekly":        7,
    "professional_monthly":  30,
    "professional_annual":   365,
    "wholesale_monthly":     30,
    "wholesale_annual":      365,
}

async function hmacHex(secret: string, body: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    )
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
    return Array.from(new Uint8Array(mac))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
}

function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

// @ts-ignore
serve(async (req: Request) => {
    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 })
    }

    // Read raw body before parsing — signature is over raw bytes.
    const rawBody = await req.text()

    // @ts-ignore
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")
    if (!webhookSecret) {
        console.error("RAZORPAY_WEBHOOK_SECRET not set")
        return new Response("Webhook secret not configured", { status: 500 })
    }

    const incomingSig = req.headers.get("X-Razorpay-Signature") ?? ""
    const expected = await hmacHex(webhookSecret, rawBody)

    if (!safeEqual(expected, incomingSig)) {
        console.error("Webhook signature mismatch")
        return new Response("Unauthorized", { status: 401 })
    }

    let event: any
    try {
        event = JSON.parse(rawBody)
    } catch {
        return new Response("Invalid JSON", { status: 400 })
    }

    // Only handle payment.captured. Acknowledge everything else with 200
    // so Razorpay stops retrying events we do not care about.
    if (event?.event !== "payment.captured") {
        return new Response(JSON.stringify({ ignored: event?.event }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
        })
    }

    const payment = event?.payload?.payment?.entity
    if (!payment) {
        return new Response("Missing payment entity", { status: 400 })
    }

    const paymentId = payment.id as string
    const orderId   = payment.order_id as string
    const amount    = payment.amount as number   // paise, stored for audit

    // @ts-ignore
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    // @ts-ignore
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    // Replay guard: if browser handler already recorded this payment, skip.
    const { data: existingPayment } = await admin
        .from("subscription_payments")
        .select("user_id")
        .eq("razorpay_payment_id", paymentId)
        .maybeSingle()

    if (existingPayment) {
        console.log(`Payment ${paymentId} already recorded, skipping webhook`)
        return new Response(JSON.stringify({ duplicate: true }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
        })
    }

    // Find user_id AND plan_type from the order anchored at order-creation time.
    // plan_type is stored there — not derived from amount — so coupons don't break it.
    let userId: string | null = null
    let planType: string | null = null

    const { data: sub } = await admin
        .from("subscriptions")
        .select("user_id, plan_type")
        .eq("razorpay_order_id", orderId)
        .maybeSingle()

    userId   = sub?.user_id   ?? null
    planType = (sub?.plan_type && sub.plan_type !== 'pending') ? sub.plan_type : null

    if (!userId) {
        const { data: prevPay } = await admin
            .from("subscription_payments")
            .select("user_id, plan_type")
            .eq("razorpay_order_id", orderId)
            .maybeSingle()
        userId   = prevPay?.user_id   ?? null
        planType = planType ?? prevPay?.plan_type ?? null
    }

    if (!userId) {
        console.error(`Cannot find user_id for order ${orderId} — payment ${paymentId} not recorded`)
        return new Response(JSON.stringify({ error: "user_not_found", orderId, paymentId }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
        })
    }

    if (!planType || !PLAN_TYPE_DAYS[planType]) {
        console.error(`Unknown plan_type "${planType}" for order ${orderId}, payment ${paymentId}`)
        return new Response(JSON.stringify({ error: "unknown_plan_type", planType, orderId }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
        })
    }

    const days = PLAN_TYPE_DAYS[planType]

    const { error } = await admin.rpc("record_subscription_payment", {
        p_user_id:      userId,
        p_plan_type:    planType,
        p_days:         days,
        p_payment_id:   paymentId,
        p_order_id:     orderId,
        p_amount_paise: amount,
    })

    if (error) {
        console.error("record_subscription_payment error:", error.message)
    } else {
        console.log(`Webhook: subscription recorded for user ${userId}, payment ${paymentId}`)
    }

    return new Response(JSON.stringify({ ok: !error }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
    })
})
