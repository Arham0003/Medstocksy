import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

console.log("Create Razorpay Order Function Invoked")

serve(async (req) => {
    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { planName } = await req.json()

        // Define Plan Details (Could also be fetched from DB)
        let amount = 0;
        if (planName === 'Professional') {
            amount = 34900; // ₹349.00 in paise
        } else {
            throw new Error("Invalid Plan Selected");
        }

        // Razorpay Credentials from Env
        const key_id = Deno.env.get('RAZORPAY_KEY_ID')
        const key_secret = Deno.env.get('RAZORPAY_KEY_SECRET')

        if (!key_id || !key_secret) {
            throw new Error("Razorpay Server Keys not configured")
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
                amount: amount,
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
                amount: amount,
                currency: "INR",
                keyId: key_id
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            },
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            },
        )
    }
})
