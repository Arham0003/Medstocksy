// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

console.log("Create Razorpay Order Function Invoked")

// @ts-ignore
serve(async (req: any) => {
    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const body = await req.json()
        const { planName, isAnnual, couponCode } = body
        const isAnnualPlan = !!isAnnual;

        console.log(`Processing order for plan: ${planName}, isAnnual: ${isAnnualPlan}, coupon: ${couponCode || 'none'}`);

        // Define Plan Details (Could also be fetched from DB)
        let baseAmount = 0;
        if (planName === 'Professional') {
            if (isAnnualPlan) {
                baseAmount = 600000; // ₹6000.00 in paise for Professional Annual
            } else {
                baseAmount = 49900; // ₹499.00 in paise for Professional Monthly
            }
        } else if (planName === 'Professional + Wholesale') {
            if (isAnnualPlan) {
                baseAmount = 720000; // ₹7,200.00 in paise for Professional + Wholesale Annual
            } else {
                baseAmount = 59900; // ₹599.00 in paise for Professional + Wholesale Monthly
            }
        } else if (planName === 'Testing Plan') {
            baseAmount = 5000; // Fixed ₹50.00 in paise for Testing Plan
        } else {
            console.error(`Invalid plan name received: ${planName}`);
            throw new Error("Invalid Plan Selected");
        }

        console.log(`Base amount: ${baseAmount} paise`);

        // Razorpay Credentials from Env
        // @ts-ignore
        const key_id = Deno.env.get('RAZORPAY_KEY_ID')
        // @ts-ignore
        const key_secret = Deno.env.get('RAZORPAY_KEY_SECRET')

        if (!key_id || !key_secret) {
            throw new Error("Razorpay Server Keys not configured")
        }

        // --- Coupon Validation ---
        let finalAmount = baseAmount;
        let discountApplied: { code: string; type: string; value: number; savedPaise: number } | null = null;

        if (couponCode && couponCode.trim() !== '') {
            // @ts-ignore
            const supabaseAdmin = createClient(
                // @ts-ignore
                Deno.env.get('SUPABASE_URL')!,
                // @ts-ignore
                Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
            )

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
        const authHeader = `Basic ${btoa(`${key_id}:${key_secret}`)}`

        const response = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader
            },
            body: JSON.stringify({
                amount: finalAmount,
                currency: "INR",
                receipt: `receipt_${Date.now()}`,
                payment_capture: 1
            })
        })

        const orderData = await response.json()

        if (orderData.error) {
            throw new Error(orderData.error.description || "Razorpay API Error")
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
