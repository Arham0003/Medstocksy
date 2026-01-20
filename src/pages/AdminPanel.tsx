import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { ShieldCheck, UserPlus, RefreshCcw } from "lucide-react";

// In a real app, you'd check a specific 'is_admin' flag or role in the user's profile.
// For now, we'll keep the route hidden or just open for this specific user.
const AdminPanel = () => {
    const { user } = useAuth();
    const [targetEmail, setTargetEmail] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleGrantTrial = async () => {
        if (!targetEmail) {
            toast.error("Please enter an email address");
            return;
        }

        setIsLoading(true);
        try {
            // 1. Get User ID from Email (using our new secure RPC function)
            const { data: userId, error: userError } = await (supabase.rpc as any)('get_user_id_by_email', { email_input: targetEmail.trim() });

            if (userError || !userId) {
                console.error("User lookup failed", userError);
                toast.error("User not found: " + targetEmail);
                return;
            }

            // 2. Insert/Update Subscription via Secure RPC (Bypasses RLS)
            const { error: subError } = await (supabase.rpc as any)('grant_admin_trial', {
                target_user_id: userId,
                trial_days: 7
            });

            if (subError) {
                console.error("Subscription update failed", subError);
                toast.error("Failed to grant trial: " + subError.message);
            } else {
                toast.success(`Success! ${targetEmail} now has 7 days of access.`);
                setTargetEmail("");
            }

        } catch (err: any) {
            console.error(err);
            toast.error("An error occurred: " + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="container mx-auto py-10 max-w-2xl">
            <Card className="border-orange-200 bg-orange-50/30">
                <CardHeader>
                    <div className="flex items-center gap-2 text-orange-600 mb-2">
                        <ShieldCheck className="h-6 w-6" />
                        <span className="font-bold uppercase tracking-wide text-xs">Admin Control</span>
                    </div>
                    <CardTitle className="text-2xl">Grant Free Trial</CardTitle>
                    <CardDescription>
                        Manually unlock access for users without payment. Ideal for demos or resolving support issues.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                User Email Address
                            </label>
                            <div className="flex gap-2">
                                <Input
                                    placeholder="user@example.com"
                                    value={targetEmail}
                                    onChange={(e) => setTargetEmail(e.target.value)}
                                    type="email"
                                    className="flex-1"
                                />
                                <Button
                                    onClick={handleGrantTrial}
                                    disabled={isLoading}
                                    className="bg-orange-600 hover:bg-orange-700"
                                >
                                    {isLoading ? <RefreshCcw className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                                    Grant 7 Days
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                This will set the user's plan to 'trial_7_days' and set expiry to 7 days from now.
                                It overwrites any existing plan.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default AdminPanel;
