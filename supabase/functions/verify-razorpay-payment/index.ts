// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Verifies a Razorpay payment and records it.
//
// The browser used to write `subscriptions` itself, which meant anyone could
// grant themselves a plan from the console, and the write was refused by RLS
// anyway. Now the signature is checked here with the key secret, and only
// then does the service role extend the subscription.
//
// Extension, not replacement: record_subscription_payment starts the new
// period when the current one ends, so buying a second month while the first
// is still running queues it rather than throwing the remaining days away.

console.log("Verify Razorpay Payment Function Invoked")

/** Razorpay signs order_id|payment_id with the key secret (HMAC SHA256, hex). */
async function expectedSignature(orderId: string, paymentId: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    )
    const mac = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${orderId}|${paymentId}`),
    )
    return Array.from(new Uint8Array(mac))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
}

/** Constant-time compare, so a wrong signature cannot be probed byte by byte. */
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

// Days granted per plan. Kept here rather than read from the request, so a
// tampered body cannot ask for 3650 days of Professional.
const PLAN_DAYS: Record<string, { monthly: number; annual: number }> = {
    "Professional": { monthly: 30, annual: 365 },
    "Professional + Wholesale": { monthly: 30, annual: 365 },
    "Testing Plan": { monthly: 7, annual: 7 },
}

const PLAN_TYPE: Record<string, { monthly: string; annual: string }> = {
    "Professional": { monthly: "professional_monthly", annual: "professional_annual" },
    "Professional + Wholesale": { monthly: "wholesale_monthly", annual: "wholesale_annual" },
    "Testing Plan": { monthly: "testing_weekly", annual: "testing_weekly" },
}

// @ts-ignore
serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            planName,
            isAnnual,
        } = await req.json()

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            throw new Error("Missing payment details")
        }
        if (!PLAN_DAYS[planName]) {
            throw new Error("Unknown plan")
        }

        // @ts-ignore
        const key_secret = Deno.env.get('RAZORPAY_KEY_SECRET')
        if (!key_secret) throw new Error("Razorpay server keys not configured")

        const expected = await expectedSignature(razorpay_order_id, razorpay_payment_id, key_secret)
        if (!safeEqual(expected, String(razorpay_signature))) {
            console.error("Signature mismatch for order", razorpay_order_id)
            return new Response(
                JSON.stringify({ error: "Payment could not be verified" }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
            )
        }

        // Identify the buyer from their own JWT, never from the request body.
        const authHeader = req.headers.get('Authorization') ?? ''
        // @ts-ignore
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        // @ts-ignore
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
        const asUser = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
        })
        const { data: { user }, error: userErr } = await asUser.auth.getUser()
        if (userErr || !user) throw new Error("Not signed in")

        const annual = !!isAnnual
        const days = annual ? PLAN_DAYS[planName].annual : PLAN_DAYS[planName].monthly
        const planType = annual ? PLAN_TYPE[planName].annual : PLAN_TYPE[planName].monthly

        // @ts-ignore
        const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
        const { data, error } = await admin.rpc('record_subscription_payment', {
            p_user_id: user.id,
            p_plan_type: planType,
            p_days: days,
            p_payment_id: razorpay_payment_id,
            p_order_id: razorpay_order_id,
            p_amount_paise: null,
        })
        if (error) throw new Error(error.message)

        return new Response(
            JSON.stringify({
                ok: true,
                planType,
                days,
                periodStart: data?.period_start,
                periodEnd: data?.period_end,
                queued: !!data?.queued,
                duplicate: !!data?.duplicate,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        )
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        return new Response(
            JSON.stringify({ error: message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
        )
    }
})
