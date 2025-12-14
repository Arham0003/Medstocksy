import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Settings as SettingsIcon, Store, DollarSign } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Settings {
  id: string;
  currency: string;
  gst_enabled: boolean;
  default_gst_rate: number;
  gst_type?: string;
  whatsapp_custom_note?: string | null;
}

interface Account {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
}

export default function Settings() {
  const { isOwner, profile } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    try {
      const [settingsRes, accountRes] = await Promise.all([
        supabase
          .from('settings')
          .select('*')
          .eq('account_id', profile?.account_id)
          .single(),
        supabase
          .from('accounts')
          .select('*')
          .eq('id', profile?.account_id)
          .single()
      ]);

      if (settingsRes.error) throw settingsRes.error;
      if (accountRes.error) throw accountRes.error;

      setSettings(settingsRes.data);
      setAccount(accountRes.data);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error fetching settings",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.account_id) {
      fetchData();
    }
  }, [profile?.account_id]);

  const handleSaveAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const name = formData.get('storeName') as string;
    const address = (formData.get('storeAddress') as string) || null;
    const phone = (formData.get('storePhone') as string) || null;
    const gstin = (formData.get('storeGSTIN') as string) || null;

    try {
      // Try to update all fields
      const { error } = await supabase
        .from('accounts')
        .update({ name, address, phone, gstin } as any)
        .eq('id', profile?.account_id);

      if (error) {
        // Check if error is likely due to missing columns
        if (error.message?.includes('column') || error.message?.includes('address') || error.message?.includes('phone') || error.message?.includes('gstin')) {
          console.warn("Extended fields not found in database, falling back to basic update");

          // Fallback: Update only 'name' which we know exists
          const { error: retryError } = await supabase
            .from('accounts')
            .update({ name })
            .eq('id', profile?.account_id);

          if (retryError) throw retryError;

          toast({
            title: "Store Name Updated",
            description: "Store name saved. Address and details could not be saved as the database needs an update.",
            variant: "default",
          });
        } else {
          throw error;
        }
      } else {
        toast({
          title: "Store information updated",
          description: "Your store information has been updated successfully.",
        });
      }

      fetchData();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error updating store information",
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const currency = formData.get('currency') as string;
    const defaultGstRate = parseFloat(formData.get('defaultGstRate') as string);
    const gstEnabled = formData.get('gstEnabled') === 'on';
    const gstType = formData.get('gstType') as string;
    const whatsappCustomNote = (formData.get('whatsappCustomNote') as string) || null;

    try {
      // Try to update with gst_type first
      let updateData: any = {
        currency,
        default_gst_rate: defaultGstRate,
        gst_enabled: gstEnabled,
        whatsapp_custom_note: whatsappCustomNote,
      };

      // Try to include gst_type
      const { error } = await supabase
        .from('settings')
        .update({
          ...updateData,
          gst_type: gstType,
        })
        .eq('account_id', profile?.account_id);

      // If error is about gst_type column, try without it
      if (error && error.message.includes('gst_type')) {
        const { error: retryError } = await supabase
          .from('settings')
          .update(updateData)
          .eq('account_id', profile?.account_id);

        if (retryError) throw retryError;

        toast({
          title: "Settings updated",
          description: "Settings saved. Note: GST Type field requires database migration.",
        });
      } else if (error) {
        throw error;
      } else {
        toast({
          title: "Settings updated",
          description: "Your settings have been updated successfully.",
        });
      }

      fetchData();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error updating settings",
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!isOwner) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">You don't have permission to access this page.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your store settings and preferences</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              Store Information
            </CardTitle>
            <CardDescription>
              Update your store details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="storeName">Store Name</Label>
                <Input
                  id="storeName"
                  name="storeName"
                  defaultValue={account?.name}
                  placeholder="Enter your store name"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="storeAddress">Address</Label>
                <Textarea
                  id="storeAddress"
                  name="storeAddress"
                  defaultValue={account?.address || ''}
                  placeholder="Enter your store address"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="storePhone">Phone Number</Label>
                <Input
                  id="storePhone"
                  name="storePhone"
                  type="tel"
                  defaultValue={account?.phone || ''}
                  placeholder="Enter store phone number"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="storeGSTIN">GSTIN Number</Label>
                <Input
                  id="storeGSTIN"
                  name="storeGSTIN"
                  defaultValue={account?.gstin || ''}
                  placeholder="Enter GST Identification Number"
                />
              </div>

              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Store Information"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Financial Settings
            </CardTitle>
            <CardDescription>
              Configure currency and tax settings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Input
                  id="currency"
                  name="currency"
                  defaultValue={settings?.currency}
                  placeholder="INR"
                  required
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="gstEnabled">Enable GST</Label>
                  <p className="text-sm text-muted-foreground">
                    Calculate and display GST on sales
                  </p>
                </div>
                <Switch
                  id="gstEnabled"
                  name="gstEnabled"
                  defaultChecked={settings?.gst_enabled}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultGstRate">Default GST Rate (%)</Label>
                <Input
                  id="defaultGstRate"
                  name="defaultGstRate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  defaultValue={settings?.default_gst_rate}
                  placeholder="18.0"
                />
              </div>

              <div className="space-y-3">
                <Label>GST Calculation Type</Label>
                <div className="flex gap-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="gstType"
                      value="exclusive"
                      defaultChecked={settings?.gst_type === 'exclusive' || !settings?.gst_type}
                      className="w-4 h-4 text-blue-600"
                    />
                    <div>
                      <span className="font-medium">Exclusive</span>
                      <p className="text-sm text-muted-foreground">GST added to price</p>
                    </div>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="gstType"
                      value="inclusive"
                      defaultChecked={settings?.gst_type === 'inclusive'}
                      className="w-4 h-4 text-blue-600"
                    />
                    <div>
                      <span className="font-medium">Inclusive</span>
                      <p className="text-sm text-muted-foreground">Price includes GST</p>
                    </div>
                  </label>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="whatsappCustomNote">WhatsApp Custom Note</Label>
                <Textarea
                  id="whatsappCustomNote"
                  name="whatsappCustomNote"
                  defaultValue={settings?.whatsapp_custom_note || ''}
                  placeholder="e.g. Dear customer, please find your prescription details below."
                />
                <p className="text-sm text-muted-foreground">
                  This note will appear at the start of every WhatsApp message. You can change it anytime.
                </p>
              </div>

              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Settings"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SettingsIcon className="h-5 w-5" />
              Account Information
            </CardTitle>
            <CardDescription>
              Your account details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Email</Label>
              <p className="text-sm text-muted-foreground mt-1">{profile?.email}</p>
            </div>
            <div>
              <Label>Account ID</Label>
              <p className="text-sm text-muted-foreground mt-1 font-mono">{profile?.account_id}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}