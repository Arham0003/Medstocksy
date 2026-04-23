import { useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/db conn/supabaseClient";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const Pricing = () => {
    const [isAnnual, setIsAnnual] = useState(false);

    useEffect(() => {
        // Dynamically load Razorpay script only when entering the Pricing page
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        document.body.appendChild(script);

        return () => {
            // Clean up: remove the script if we leave the page (optional, but keep it clean)
            if (document.body.contains(script)) {
                document.body.removeChild(script);
            }
        };
    }, []);

    const plans = [
        {
            name: "Testing Plan",
            description: "Try all our premium features for 7 days.",
            price: "₹50",
            originalPrice: null,
            discount: null,
            period: "/ 7 days",
            features: [
                { name: "Unlimited Products", included: true },
                { name: "CRM", included: true },
                { name: "Inventory Forecasting", included: true },
                { name: "Sales Analytics", included: true },
            ],
            saving: null,
            cta: "Get Started",
            variant: "outline" as const,
            disabled: false,
            showInAnnual: false,
        },
        {
            name: "Professional",
            description: "Everything for a busy, growing medical shop.",
            price: isAnnual ? "₹3,999" : "₹399",
            originalPrice: isAnnual ? "₹6,000" : "₹500",
            discount: isAnnual ? "33% OFF" : "20% OFF",
            period: isAnnual ? "/year" : "/month",
            features: [
                { name: "Unlimited Products", included: true },
                { name: "CRM", included: true },
                { name: "Inventory Forecasting", included: true },
                { name: "Sales Analytics", included: true },
            ],
            saving: isAnnual ? "Save ₹2,001/year" : "Save ₹101/month",
            cta: "Get Started",
            popular: true,
            variant: "default" as const,
            disabled: false,
            showInAnnual: true,
        },
        {
            name: "Enterprise",
            description: "Multi-store management and advanced features.",
            price: "₹-",
            originalPrice: null,
            discount: null,
            period: isAnnual ? "/year" : "/month",
            features: [
                { name: "Up to 5 Stores", included: true },
                { name: "Centralized Inventory", included: true },
                { name: "Advanced Analytics", included: true },
                { name: "Priority Support", included: true },
            ],
            saving: null,
            cta: "Contact Sales",
            variant: "outline" as const,
            disabled: true,
            showInAnnual: true,
        },
    ];

    const filteredPlans = plans.filter(plan => !isAnnual || plan.showInAnnual);


    const handleSubscribe = async (planName: string) => {
        if (planName === "Professional" || planName === "Testing Plan") {
            try {
                toast.info("Initializing Checkout...");

                console.log("Invoking create-razorpay-order with:", { planName, isAnnual });
                
                // 1. Call Edge Function to create order
                const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
                    body: { planName, isAnnual: !!isAnnual }
                });

                if (error) {
                    console.error("Supabase function invocation error:", error);
                    throw error;
                }
                
                if (data.error) {
                    console.error("Edge function returned error:", data.error);
                    throw new Error(data.error);
                }
                
                console.log("Order created successfully:", data);

                // 2. Open Razorpay options
                const options = {
                    key: data.keyId,
                    amount: data.amount,
                    currency: data.currency,
                    name: "Medstocksy",
                    description: `${planName} Subscription`,
                    order_id: data.orderId,
                    handler: async function (response: any) {
                        toast.success("Payment Successful! Activating plan...");

                        const planType = planName === "Professional" 
                            ? (isAnnual ? 'professional_annual' : 'professional_monthly') 
                            : 'testing_weekly';
                        const days = planName === "Professional" 
                            ? (isAnnual ? 365 : 30) 
                            : 7;

                        // 3. Update Subscription in DB (Ideally done via Webhook, but update client-side for UX speed)
                        // Note: This requires RLS to allow INSERT/UPDATE on 'subscriptions' for authenticated users
                        // strictly for their own rows.
                        const { error: updateError } = await supabase
                            .from('subscriptions' as any)
                            .upsert({
                                user_id: (await supabase.auth.getUser()).data.user?.id,
                                plan_type: planType,
                                status: 'active',
                                current_period_start: new Date().toISOString(),
                                current_period_end: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                            });

                        if (updateError) {
                            console.error("Failed to update local record", updateError);
                            toast.error("Payment received but status update failed. Please contacting support.");
                        } else {
                            // Reload to clear the 'Subscription Expired' popup
                            window.location.reload();
                        }
                    },
                    prefill: {
                        name: "Pharmacy Owner",
                        contact: ""
                    },
                    theme: {
                        color: "#3399cc"
                    }
                };

                const rzp1 = new (window as any).Razorpay(options);
                rzp1.on('payment.failed', function (response: any) {
                    toast.error(response.error.description || "Payment Failed");
                });
                rzp1.open();

            } catch (err: any) {
                console.error(err);
                toast.error("Checkout Failed: " + (err.message || "Unknown error"));
            }
        }
    };

    return (
        <div className="min-h-screen bg-gray-50/50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto space-y-8">
                <div className="flex flex-col items-center space-y-4">
                    <h2 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
                        Simple, <span className="text-blue-600">Transparent</span> Pricing
                    </h2>
                    <p className="text-xl text-muted-foreground italic">Choose the plan that's right for your pharmacy business</p>
                    
                    <div className="flex items-center p-1 bg-gray-100 rounded-full w-fit mt-8 border border-gray-200 shadow-sm relative">
                        <button
                            onClick={() => setIsAnnual(false)}
                            className={`px-6 py-2 rounded-full text-sm font-semibold transition-all duration-300 ${
                                !isAnnual 
                                ? 'bg-white text-blue-600 shadow-sm' 
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Monthly
                        </button>
                        <button
                            onClick={() => setIsAnnual(true)}
                            className={`px-6 py-2 rounded-full text-sm font-semibold transition-all duration-300 relative ${
                                isAnnual 
                                ? 'bg-white text-blue-600 shadow-sm' 
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Annual
                            <span className="absolute -top-3 -right-2 bg-emerald-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                                SAVE 33%
                            </span>
                        </button>
                    </div>
                </div>

                <div className={`grid grid-cols-1 ${filteredPlans.length === 1 ? 'md:grid-cols-1 max-w-md mx-auto' : filteredPlans.length === 2 ? 'md:grid-cols-2 max-w-4xl mx-auto' : 'md:grid-cols-3'} gap-8 pt-8`}>
                    {filteredPlans.map((plan) => (
                        <Card
                            key={plan.name}
                            className={`flex flex-col relative transition-all duration-200 ${plan.popular
                                ? 'border-blue-500 shadow-lg scale-105 z-10'
                                : 'border-gray-200 hover:shadow-md'
                                }`}
                        >
                            {plan.popular && (
                                <div className="absolute -top-4 left-0 right-0 flex justify-center">
                                    <span className="bg-blue-500 text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                                        Most Popular
                                    </span>
                                </div>
                            )}

                            <CardHeader>
                                <CardTitle className="text-xl font-bold text-gray-900">{plan.name}</CardTitle>
                                <div className="mt-4 flex flex-col">
                                    {plan.originalPrice && (
                                        <span className="text-sm font-medium text-gray-400 line-through decoration-red-500 decoration-2">
                                            {plan.originalPrice}
                                        </span>
                                    )}
                                    <div className="flex items-baseline text-gray-900">
                                        <span className="text-4xl font-extrabold tracking-tight">{plan.price}</span>
                                        <span className="ml-1 text-sm font-semibold text-gray-500">{plan.period}</span>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {plan.discount && (
                                        <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600 text-white border-none text-[10px] font-bold py-0 h-5">
                                            {plan.discount}
                                        </Badge>
                                    )}
                                    {plan.saving && (
                                        <Badge variant="secondary" className="text-emerald-600 bg-emerald-50 hover:bg-emerald-100 w-fit text-[10px]">
                                            {plan.saving}
                                        </Badge>
                                    )}
                                </div>
                                <p className="mt-4 text-sm text-gray-500">{plan.description}</p>
                            </CardHeader>

                            <CardContent className="flex-1">
                                <ul className="space-y-4">
                                    {plan.features.map((feature) => (
                                        <li key={feature.name} className="flex items-start">
                                            <div className="flex-shrink-0">
                                                {feature.included ? (
                                                    <Check className="h-5 w-5 text-emerald-500" />
                                                ) : (
                                                    <X className="h-5 w-5 text-gray-300" />
                                                )}
                                            </div>
                                            <p className={`ml-3 text-sm ${feature.included ? 'text-gray-700' : 'text-gray-400'}`}>
                                                {feature.name}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>

                            <CardFooter>
                                <Button
                                    variant={plan.popular ? "default" : "outline"}
                                    className={`w-full ${plan.popular ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                                    disabled={plan.disabled}
                                    onClick={() => handleSubscribe(plan.name)}
                                >
                                    {plan.cta}
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Pricing;

