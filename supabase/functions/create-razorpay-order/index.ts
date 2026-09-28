// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

console.log("Create Razorpay Order Function Invoked")

// @ts-ignore
serve(async (req: any) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const body = await req.json()
        const { planName, isAnnual, couponCode } = body
        const isAnnualPlan = !!isAnnual;

        console.log(`Processing order for plan: ${planName}, isAnnual: ${isAnnualPlan}, coupon: ${couponCode || 'none'}`);

        // Identify the buyer early so we can store order_id → user_id for the webhook.
        // @ts-ignore
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        // @ts-ignore
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
        const authHeader = req.headers.get('Authorization') ?? ''
        const asUser = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
        })
        const { data: { user }, error: userErr } = await asUser.auth.getUser()
        if (userErr || !user) throw new Error('Not signed in')

        // Plan amount + type derived together so they stay in sync.
        // planType is stored in subscriptions so the webhook can look it up
        // regardless of the final charged amount (coupons can change amount).
        const PLAN_LOOKUP: Record<string, { baseAmount: number; monthly: string; annual: string; monthlyDays: number; annualDays: number }> = {
            'Professional':           { baseAmount: isAnnualPlan ? 600000 : 49900, monthly: 'professional_monthly', annual: 'professional_annual', monthlyDays: 30, annualDays: 365 },
            'Professional + Wholesale': { baseAmount: isAnnualPlan ? 720000 : 59900, monthly: 'wholesale_monthly',      annual: 'wholesale_annual',      monthlyDays: 30, annualDays: 365 },
            'Testing Plan':           { baseAmount: 5000,                           monthly: 'testing_weekly',         annual: 'testing_weekly',         monthlyDays: 7,  annualDays: 7   },
        }
        const planEntry = PLAN_LOOKUP[planName]
        if (!planEntry) {
            console.error(`Invalid plan name received: ${planName}`);
            throw new Error("Invalid Plan Selected");
        }
        let baseAmount = planEntry.baseAmount;
        const planType = isAnnualPlan ? planEntry.annual : planEntry.monthly;

        console.log(`Base amount: ${baseAmount} paise`);

        // Razorpay Credentials from Env
        // @ts-ignore
        const key_id = Deno.env.get('RAZORPAY_KEY_ID')
        // @ts-ignore
        const key_secret = Deno.env.get('RAZORPAY_KEY_SECRET')

        if (!key_id || !key_secret) {
            throw new Error("Razorpay Server Keys not configured")
        }

        // Admin client for coupon lookup and order anchoring.
        // @ts-ignore
        const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

        // --- Coupon Validation ---
        let finalAmount = baseAmount;
        let discountApplied: { code: string; type: string; value: number; savedPaise: number } | null = null;

        if (couponCode && couponCode.trim() !== '') {
            const { data: coupon, error: couponErr } = await supabaseAdmin
                .from('coupons')
                .select('*')
                .ilike('code', couponCode.trim())
                .single()

            if (couponErr || !coupon) {
                throw new Error("Invalid coupon code")
            }
            if (!coupon.is_active) {
                throw new Error("Coupon is no longer active")
            }
            if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
                throw new Error("Coupon has expired")
            }
            if (coupon.used_count >= coupon.max_uses) {
                throw new Error("Coupon usage limit reached")
            }

            // Calculate discount
            let savedPaise = 0;
            if (coupon.discount_type === 'flat') {
                savedPaise = Math.min(Number(coupon.discount_value), baseAmount - 100); // keep min ₹1
            } else if (coupon.discount_type === 'percent') {
                savedPaise = Math.round(baseAmount * Number(coupon.discount_value) / 100);
            }

            finalAmount = baseAmount - savedPaise;
            if (finalAmount < 100) finalAmount = 100; // Razorpay min ₹1

            // Increment used_count atomically
            await supabaseAdmin
                .from('coupons')
                .update({ used_count: coupon.used_count + 1 })
                .eq('id', coupon.id)

            discountApplied = {
                code: coupon.code,
                type: coupon.discount_type,
                value: coupon.discount_value,
                savedPaise,
            }

            console.log(`Coupon applied: ${coupon.code}, saved ${savedPaise} paise, final: ${finalAmount}`);
        }

        // Create Order via Razorpay API
        const razorpayAuth = `Basic ${btoa(`${key_id}:${key_secret}`)}`

        const response = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': razorpayAuth
            },
                    body: JSON.stringify({
                amount: finalAmount,
                currency: "INR",
                receipt: `receipt_${Date.now()}`,
                payment_capture: 1,
                // Store plan_type in notes so the webhook has a second source of truth
                // even if the subscriptions lookup fails.
                notes: { plan_type: planType, is_annual: String(isAnnualPlan) },
            })
        })

        const orderData = await response.json()

        if (orderData.error) {
            throw new Error(orderData.error.description || "Razorpay API Error")
        }

        // Anchor order_id → user_id so the webhook can find the buyer
        // even if the browser tab closes before verify-razorpay-payment fires.
        // For existing subscribers: only update razorpay_order_id (don't touch plan/status).
        // For new users: insert a minimal pending row; verify will overwrite with real values.
        const { error: insertErr } = await supabaseAdmin
            .from('subscriptions')
            .insert({ user_id: user.id, razorpay_order_id: orderData.id, plan_type: planType, status: 'pending' })

        if (insertErr) {
            // Row already exists (existing subscriber) — stamp the new order_id and planType.
            await supabaseAdmin
                .from('subscriptions')
                .update({ razorpay_order_id: orderData.id, plan_type: planType })
                .eq('user_id', user.id)
        }

        return new Response(
            JSON.stringify({
                orderId: orderData.id,
                amount: finalAmount,
                currency: "INR",
                keyId: key_id,
                discountApplied,
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            },
        )

    } catch (error: any) {
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            },
        )
    }
})
