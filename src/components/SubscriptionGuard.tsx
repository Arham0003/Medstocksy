import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Crown } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const SubscriptionGuard = ({ children }: { children: React.ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const checkSubscription = async () => {
            if (!user) return;

            try {
                const { data, error } = await supabase
                    .from("subscriptions" as any)
                    .select("status, current_period_end")
                    .eq("user_id", user.id)
                    .single();

                // FAIL OPEN for demo/dev if table doesn not exist yet to prevent total lockout
                if (error && error.code !== "PGRST116") { // PGRST116 is 'not found'
                    console.warn("Subscription check failed (possibly missing table), defaulting to allowed.", error);
                    setIsLoading(false);
                    return;
                }

                if (!data) {
                    // No subscription found -> Potentially new user.
                    setIsOpen(true);
                } else {
                    const subData = data as any;
                    const isExpired = new Date(subData.current_period_end) < new Date();
                    if (subData.status !== "active" || isExpired) {
                        setIsOpen(true);
                    }
                }
            } catch (err) {
                console.error("Subscription guard error:", err);
            } finally {
                setIsLoading(false);
            }
        };

        // Only check on initial mount or route change? 
        // Checking on every route change might be aggressive, but ensures security.
        checkSubscription();
    }, [user, location.pathname]);

    // If we are already on the pricing page, don't block!
    if (location.pathname === "/pricing") {
        return <>{children}</>;
    }

    const handleRenew = () => {
        setIsOpen(false);
        navigate("/pricing");
    };

    return (
        <>
            {children}
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
                    <DialogHeader>
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                            <AlertTriangle className="h-6 w-6 text-red-600" />
                        </div>
                        <DialogTitle className="text-center text-xl pt-4">Subscription Expired</DialogTitle>
                        <DialogDescription className="text-center pt-2">
                            Your subscription has ended. To continue managing your inventory and sales seamlessly, please renew your plan.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="bg-muted/50 p-4 rounded-lg flex items-center gap-3 my-2">
                        <Crown className="h-8 w-8 text-orange-500" />
                        <div>
                            <p className="font-semibold">Upgrade to Professional</p>
                            <p className="text-sm text-muted-foreground">Unlock unlimited products & analytics</p>
                        </div>
                    </div>

                    <DialogFooter className="sm:justify-center">
                        <Button className="w-full sm:w-auto" size="lg" onClick={handleRenew}>
                            Renew Subscription
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default SubscriptionGuard;
