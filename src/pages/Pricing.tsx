import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

const Pricing = () => {
    const [isAnnual, setIsAnnual] = useState(false);

    const plans = [
        {
            name: "Starter",
            description: "Perfect for new pharmacies starting their digital journey.",
            price: isAnnual ? "₹-" : "₹-",
            period: isAnnual ? "/year" : "/month",
            features: [
                { name: "Up to 500 Products", included: true },
                { name: "Basic Billing", included: true },
                { name: "Mobile Dashboard", included: true },
                { name: "WhatsApp Alerts", included: false },
            ],
            saving: isAnnual ? "Save ₹123/year" : null,
            cta: "Get Started",
            variant: "outline" as const,
            disabled: true,
        },
        {
            name: "Professional",
            description: "Everything for a busy, growing medical shop.",
            price: isAnnual ? "₹3,490" : "₹349",
            period: isAnnual ? "/year" : "/month",
            features: [
                { name: "Unlimited Products", included: true },
                { name: "CRM", included: true },
                { name: "Inventory Forecasting", included: true },
                { name: "Sales Analytics", included: true },
            ],
            saving: isAnnual ? "Save ₹698/year" : null,
            cta: "Get Started",
            popular: true,
            variant: "default" as const,
            disabled: false,
        },
        {
            name: "Enterprise",
            description: "Multi-store management and advanced features.",
            price: isAnnual ? "₹-" : "₹-",
            period: isAnnual ? "/year" : "/month",
            features: [
                { name: "Up to 5 Stores", included: true },
                { name: "Centralized Inventory", included: true },
                { name: "Advanced Analytics", included: true },
                { name: "Priority Support", included: true },
            ],
            saving: null, // "Save ₹1,371/year" in screenshot but price is masked
            cta: "Contact Sales",
            variant: "outline" as const,
            disabled: true,
        },
    ];


    const handleSubscribe = async (planName: string) => {
        if (planName === "Professional") {
            try {
                toast.info("Initializing Checkout...");

                // 1. Call Edge Function to create order
                const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
                    body: { planName: 'Professional' }
                });

                if (error) throw error;
                if (data.error) throw new Error(data.error);

                // 2. Open Razorpay options
                const options = {
                    key: data.keyId,
                    amount: data.amount,
                    currency: data.currency,
                    name: "Medstocksy",
                    description: "Professional Plan Subscription",
                    order_id: data.orderId,
                    handler: async function (response: any) {
                        toast.success("Payment Successful! Activating plan...");

                        // 3. Update Subscription in DB (Ideally done via Webhook, but update client-side for UX speed)
                        // Note: This requires RLS to allow INSERT/UPDATE on 'subscriptions' for authenticated users
                        // strictly for their own rows.
                        const { error: updateError } = await supabase
                            .from('subscriptions' as any)
                            .upsert({
                                user_id: (await supabase.auth.getUser()).data.user?.id,
                                plan_type: 'professional_monthly',
                                status: 'active',
                                current_period_start: new Date().toISOString(),
                                current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // +30 days
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
                <div className="text-center space-y-4">
                    {/* Toggle (Monthly / Annual) */}
                    <div className="flex items-center justify-center space-x-4">
                        <span className={`text-sm ${!isAnnual ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>Monthly</span>
                        <Switch
                            checked={isAnnual}
                            onCheckedChange={setIsAnnual}
                            className="data-[state=checked]:bg-primary"
                        />
                        <span className={`text-sm ${isAnnual ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                            Annual <span className="text-emerald-500 font-medium">(Save 20%)</span>
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8">
                    {plans.map((plan) => (
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
                                <div className="mt-4 flex items-baseline text-gray-900">
                                    <span className="text-4xl font-extrabold tracking-tight">{plan.price}</span>
                                    <span className="ml-1 text-sm font-semibold text-gray-500">{plan.period}</span>
                                </div>
                                {plan.saving && (
                                    <Badge variant="secondary" className="mt-2 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 w-fit">
                                        {plan.saving}
                                    </Badge>
                                )}
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
