import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Settings as SettingsIcon,
  Store,
  DollarSign,
  MessageCircle,
  User,
  Mail,
  Fingerprint,
  Phone,
  MapPin,
  Receipt,
  Percent,
  Tag,
  CircleDollarSign,
  ShieldCheck,
  Clock,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Settings {
  id: string;
  currency: string;
  gst_enabled: boolean;
  default_gst_rate: number;
  gst_type?: string;
  whatsapp_custom_note?: string | null;
  sales_edit_window_hours?: number | null;
}

interface Account {
  id: string;
  name: string;
  manager_name?: string | null;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
}

// Reusable section header (icon bubble + title + description)
const SectionHeader = ({
  icon: Icon,
  title,
  description,
  iconBg = 'bg-blue-50',
  iconColor = 'text-blue-600',
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  iconBg?: string;
  iconColor?: string;
}) => (
  <div className="flex items-start gap-3">
    <div className={cn('p-2.5 rounded-xl shrink-0', iconBg)}>
      <Icon className={cn('h-5 w-5', iconColor)} />
    </div>
    <div className="min-w-0">
      <CardTitle className="text-lg font-semibold text-slate-900">{title}</CardTitle>
      <CardDescription className="text-sm mt-0.5">{description}</CardDescription>
    </div>
  </div>
);

// Label with an optional icon prefix
const FieldLabel = ({
  htmlFor,
  icon: Icon,
  children,
}: {
  htmlFor?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) => (
  <Label htmlFor={htmlFor} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
    {Icon && <Icon className="h-3.5 w-3.5 text-slate-400" />}
    {children}
  </Label>
);

export default function Settings() {
  const { isOwner, profile } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gstTypeState, setGstTypeState] = useState<'exclusive' | 'inclusive'>('exclusive');
  const [gstEnabledState, setGstEnabledState] = useState<boolean>(false);

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
          .single(),
      ]);

      if (settingsRes.error) throw settingsRes.error;
      if (accountRes.error) throw accountRes.error;

      setSettings(settingsRes.data);
      setAccount(accountRes.data);
      // gst_type column is added by a later migration and may not exist in the strict generated types
      const settingsRaw: any = settingsRes.data;
      if (settingsRaw?.gst_type === 'inclusive' || settingsRaw?.gst_type === 'exclusive') {
        setGstTypeState(settingsRaw.gst_type);
      }
      setGstEnabledState(Boolean(settingsRaw?.gst_enabled));
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error fetching settings',
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
    const manager_name = (formData.get('managerName') as string) || null;
    const address = (formData.get('storeAddress') as string) || null;
    const phone = (formData.get('storePhone') as string) || null;
    const gstin = (formData.get('storeGSTIN') as string) || null;

    try {
      const { error } = await supabase
        .from('accounts')
        .update({ name, manager_name, address, phone, gstin } as any)
        .eq('id', profile?.account_id);

      if (error) {
        if (
          error.message?.includes('column') ||
          error.message?.includes('address') ||
          error.message?.includes('phone') ||
          error.message?.includes('gstin') ||
          error.message?.includes('manager_name')
        ) {
          console.warn('Extended fields not found in database, falling back to basic update');

          const { error: retryError } = await supabase
            .from('accounts')
            .update({ name })
            .eq('id', profile?.account_id);

          if (retryError) throw retryError;

          toast({
            title: 'Store Name Updated',
            description:
              'Store name saved. Address and details could not be saved as the database needs an update.',
            variant: 'default',
          });
        } else {
          throw error;
        }
      } else {
        toast({
          title: 'Store information updated',
          description: 'Your store information has been updated successfully.',
        });
      }

      fetchData();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error updating store information',
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
    const gstEnabled = gstEnabledState;
    const gstType = gstTypeState;
    const whatsappCustomNote = (formData.get('whatsappCustomNote') as string) || null;
    const rawEditWindow = parseInt(formData.get('salesEditWindowHours') as string);
    const salesEditWindowHours = Number.isFinite(rawEditWindow) && rawEditWindow > 0 ? rawEditWindow : 24;

    try {
      // Core columns always exist; the optional ones need later migrations.
      const core: any = {
        currency,
        default_gst_rate: defaultGstRate,
        gst_enabled: gstEnabled,
        whatsapp_custom_note: whatsappCustomNote,
      };
      const withOptional = { ...core, gst_type: gstType, sales_edit_window_hours: salesEditWindowHours };

      const { error } = await supabase
        .from('settings')
        .update(withOptional)
        .eq('account_id', profile?.account_id);

      if (error) {
        // A newer column (gst_type / sales_edit_window_hours) may not exist yet → save the core fields.
        const { error: retryError } = await supabase
          .from('settings')
          .update(core)
          .eq('account_id', profile?.account_id);
        if (retryError) throw retryError;
        toast({
          title: 'Settings updated',
          description: 'Saved. Some newer fields (GST type / edit window) need a database migration.',
        });
      } else {
        toast({
          title: 'Settings updated',
          description: 'Your settings have been updated successfully.',
        });
      }

      fetchData();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error updating settings',
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Settings
          </h1>
          <p className="text-muted-foreground text-lg mt-2">
            Manage your store, tax, notifications, and account preferences
          </p>
        </div>
        {/* Compact signed-in chip */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs text-slate-600">
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center text-[10px] font-bold">
            {(profile?.email?.[0] || '?').toUpperCase()}
          </div>
          <span className="font-medium text-slate-800 truncate max-w-[180px]">{profile?.email}</span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="h-10 w-full bg-slate-100 animate-pulse rounded-lg" />
          <div className="h-64 w-full bg-slate-100 animate-pulse rounded-xl" />
        </div>
      ) : (
        <Tabs defaultValue="store" className="w-full">
          {/* Scrollable tab bar for small screens */}
          <TabsList className="w-full h-auto p-1 bg-slate-100/80 rounded-xl flex-wrap justify-start sm:justify-center">
            <TabsTrigger
              value="store"
              className="flex-1 sm:flex-none gap-2 data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm py-2 px-3"
            >
              <Store className="h-4 w-4" />
              <span className="hidden sm:inline">Store Info</span>
              <span className="sm:hidden">Store</span>
            </TabsTrigger>
            <TabsTrigger
              value="tax"
              className="flex-1 sm:flex-none gap-2 data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm py-2 px-3"
            >
              <Percent className="h-4 w-4" />
              <span className="hidden sm:inline">Tax & Currency</span>
              <span className="sm:hidden">Tax</span>
            </TabsTrigger>
            <TabsTrigger
              value="notifications"
              className="flex-1 sm:flex-none gap-2 data-[state=active]:bg-white data-[state=active]:text-violet-700 data-[state=active]:shadow-sm py-2 px-3"
            >
              <MessageCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Notifications</span>
              <span className="sm:hidden">Notif.</span>
            </TabsTrigger>
            <TabsTrigger
              value="account"
              className="flex-1 sm:flex-none gap-2 data-[state=active]:bg-white data-[state=active]:text-slate-700 data-[state=active]:shadow-sm py-2 px-3"
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Account</span>
              <span className="sm:hidden">Account</span>
            </TabsTrigger>
          </TabsList>

          {/* STORE INFO TAB */}
          <TabsContent value="store" className="mt-6">
            <Card className="shadow-sm border-slate-200">
              <CardHeader>
                <SectionHeader
                  icon={Store}
                  title="Store Information"
                  description="Details printed on bills and shown to customers"
                  iconBg="bg-blue-50"
                  iconColor="text-blue-600"
                />
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveAccount} className="space-y-5">
                  <div className="space-y-2">
                    <FieldLabel htmlFor="storeName" icon={Tag}>Store Name <span className="text-rose-500">*</span></FieldLabel>
                    <Input
                      id="storeName"
                      name="storeName"
                      defaultValue={account?.name}
                      placeholder="e.g. Medstocksy Pharmacy"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <FieldLabel htmlFor="managerName" icon={User}>Manager Name</FieldLabel>
                      <Input
                        id="managerName"
                        name="managerName"
                        defaultValue={account?.manager_name || ''}
                        placeholder="Enter manager name"
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel htmlFor="storePhone" icon={Phone}>Phone Number</FieldLabel>
                      <Input
                        id="storePhone"
                        name="storePhone"
                        type="tel"
                        defaultValue={account?.phone || ''}
                        placeholder="e.g. +91 98765 43210"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <FieldLabel htmlFor="storeAddress" icon={MapPin}>Address</FieldLabel>
                    <Textarea
                      id="storeAddress"
                      name="storeAddress"
                      defaultValue={account?.address || ''}
                      placeholder="Street, city, state, PIN"
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <FieldLabel htmlFor="storeGSTIN" icon={Receipt}>GSTIN Number</FieldLabel>
                    <Input
                      id="storeGSTIN"
                      name="storeGSTIN"
                      defaultValue={account?.gstin || ''}
                      placeholder="15-character GST Identification Number"
                    />
                    <p className="text-xs text-muted-foreground">
                      Appears on invoices when GST is enabled.
                    </p>
                  </div>

                  <div className="flex justify-end pt-2 border-t border-slate-100">
                    <Button
                      type="submit"
                      disabled={saving}
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 min-w-[160px]"
                    >
                      {saving ? (
                        <div className="flex items-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          Saving…
                        </div>
                      ) : (
                        'Save Store Info'
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAX & CURRENCY TAB */}
          <TabsContent value="tax" className="mt-6">
            <Card className="shadow-sm border-slate-200">
              <CardHeader>
                <SectionHeader
                  icon={Percent}
                  title="Tax & Currency"
                  description="Configure how GST and currency appear on bills"
                  iconBg="bg-emerald-50"
                  iconColor="text-emerald-600"
                />
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveSettings} className="space-y-6">
                  {/* Currency + default rate in one row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <FieldLabel htmlFor="currency" icon={CircleDollarSign}>Currency</FieldLabel>
                      <Input
                        id="currency"
                        name="currency"
                        defaultValue={settings?.currency}
                        placeholder="INR"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel htmlFor="defaultGstRate" icon={Percent}>Default GST Rate (%)</FieldLabel>
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
                  </div>

                  {/* Sales edit window */}
                  <div className="space-y-2 max-w-xs">
                    <FieldLabel htmlFor="salesEditWindowHours" icon={Clock}>Sales edit window (hours)</FieldLabel>
                    <Input
                      id="salesEditWindowHours"
                      name="salesEditWindowHours"
                      type="number"
                      min="1"
                      step="1"
                      defaultValue={settings?.sales_edit_window_hours ?? 24}
                      placeholder="24"
                    />
                    <p className="text-xs text-muted-foreground">
                      How long after a sale is recorded it can still be edited. Default 24 hours.
                    </p>
                  </div>

                  {/* GST enable — big clickable toggle card */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={gstEnabledState}
                    aria-label="Enable GST on sales"
                    onClick={() => setGstEnabledState(v => !v)}
                    className={cn(
                      'w-full text-left p-4 sm:p-5 rounded-xl border-2 transition-all group',
                      gstEnabledState
                        ? 'border-emerald-500 bg-gradient-to-br from-emerald-50 to-white shadow-sm'
                        : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-slate-50'
                    )}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={cn(
                            'p-2 rounded-lg shrink-0 transition-colors',
                            gstEnabledState
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-200 text-slate-500'
                          )}
                        >
                          <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900 text-sm sm:text-base">
                              Enable GST on sales
                            </span>
                            <span
                              className={cn(
                                'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full',
                                gstEnabledState
                                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                  : 'bg-slate-200 text-slate-600 border border-slate-300'
                              )}
                            >
                              {gstEnabledState ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                            {gstEnabledState
                              ? 'GST is being calculated and printed on every bill.'
                              : 'GST will not be added to prices or shown on bills.'}
                          </p>
                        </div>
                      </div>

                      {/* Custom toggle pill */}
                      <div
                        className={cn(
                          'shrink-0 relative h-7 w-12 rounded-full transition-colors duration-200 border',
                          gstEnabledState
                            ? 'bg-emerald-500 border-emerald-600'
                            : 'bg-slate-300 border-slate-400 group-hover:bg-slate-400'
                        )}
                      >
                        <div
                          className={cn(
                            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-200',
                            gstEnabledState ? 'left-[22px]' : 'left-0.5'
                          )}
                        />
                      </div>
                    </div>
                  </button>

                  {/* GST type as pill cards */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium text-slate-700">GST Calculation Type</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(
                        [
                          {
                            value: 'exclusive',
                            title: 'Exclusive',
                            desc: 'GST is added on top of the selling price',
                          },
                          {
                            value: 'inclusive',
                            title: 'Inclusive',
                            desc: 'Selling price already includes GST',
                          },
                        ] as const
                      ).map(opt => {
                        const active = gstTypeState === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setGstTypeState(opt.value)}
                            className={cn(
                              'text-left p-4 rounded-xl border-2 transition-all',
                              active
                                ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-100'
                                : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/30'
                            )}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className={cn('font-semibold', active ? 'text-emerald-700' : 'text-slate-800')}>
                                {opt.title}
                              </span>
                              <div
                                className={cn(
                                  'h-4 w-4 rounded-full border-2 flex items-center justify-center',
                                  active ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'
                                )}
                              >
                                {active && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">{opt.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                    {/* Hidden input so FormData still has it (save handler uses gstTypeState anyway) */}
                    <input type="hidden" name="gstType" value={gstTypeState} />
                  </div>

                  <div className="flex justify-end pt-2 border-t border-slate-100">
                    <Button
                      type="submit"
                      disabled={saving}
                      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 min-w-[160px]"
                    >
                      {saving ? (
                        <div className="flex items-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          Saving…
                        </div>
                      ) : (
                        'Save Tax Settings'
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* NOTIFICATIONS TAB */}
          <TabsContent value="notifications" className="mt-6">
            <Card className="shadow-sm border-slate-200">
              <CardHeader>
                <SectionHeader
                  icon={MessageCircle}
                  title="WhatsApp Notifications"
                  description="Customize the opening line used when messaging customers"
                  iconBg="bg-violet-50"
                  iconColor="text-violet-600"
                />
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveSettings} className="space-y-5">
                  {/* We reuse handleSaveSettings to save the note; other fields submit via hidden inputs below */}
                  <input type="hidden" name="currency" value={settings?.currency || 'INR'} />
                  <input
                    type="hidden"
                    name="defaultGstRate"
                    value={settings?.default_gst_rate ?? 18}
                  />
                  <input
                    type="hidden"
                    name="gstEnabled"
                    value={gstEnabledState ? 'on' : 'off'}
                  />

                  <div className="space-y-2">
                    <FieldLabel htmlFor="whatsappCustomNote" icon={MessageCircle}>
                      Custom intro note
                    </FieldLabel>
                    <Textarea
                      id="whatsappCustomNote"
                      name="whatsappCustomNote"
                      defaultValue={settings?.whatsapp_custom_note || ''}
                      placeholder="e.g. Dear customer, please find your prescription details below."
                      rows={4}
                    />
                    <p className="text-xs text-muted-foreground">
                      Appears at the start of every WhatsApp message. Leave empty to skip.
                    </p>
                  </div>

                  {/* Preview */}
                  <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50/60 to-white p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <MessageCircle className="h-4 w-4 text-violet-600" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-violet-700">
                        Preview
                      </span>
                    </div>
                    <div className="rounded-lg bg-white border border-violet-100 p-3 text-sm text-slate-700 whitespace-pre-wrap min-h-[64px]">
                      {settings?.whatsapp_custom_note?.trim()
                        ? settings.whatsapp_custom_note
                        : <span className="italic text-muted-foreground">No custom note set — messages will start with the bill summary.</span>}
                    </div>
                  </div>

                  <div className="flex justify-end pt-2 border-t border-slate-100">
                    <Button
                      type="submit"
                      disabled={saving}
                      className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 min-w-[160px]"
                    >
                      {saving ? (
                        <div className="flex items-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          Saving…
                        </div>
                      ) : (
                        'Save Notifications'
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ACCOUNT TAB */}
          <TabsContent value="account" className="mt-6">
            <Card className="shadow-sm border-slate-200">
              <CardHeader>
                <SectionHeader
                  icon={SettingsIcon}
                  title="Account"
                  description="Read-only details about your Medstocksy account"
                  iconBg="bg-slate-100"
                  iconColor="text-slate-700"
                />
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      <Mail className="h-3.5 w-3.5" />
                      Email
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900 truncate">{profile?.email}</p>
                      <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border border-emerald-100">
                        Verified
                      </Badge>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      <Fingerprint className="h-3.5 w-3.5" />
                      Account ID
                    </div>
                    <p className="text-xs font-mono text-slate-900 break-all">{profile?.account_id}</p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      <Store className="h-3.5 w-3.5" />
                      Store
                    </div>
                    <p className="text-sm font-medium text-slate-900 truncate">{account?.name || '—'}</p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      <DollarSign className="h-3.5 w-3.5" />
                      Currency
                    </div>
                    <p className="text-sm font-medium text-slate-900">{settings?.currency || 'INR'}</p>
                  </div>
                </div>

                <div className="mt-4 p-4 rounded-xl bg-blue-50/60 border border-blue-100 text-xs text-blue-800">
                  Need to change your email or password? Use the menu in the top navigation to
                  sign out and manage your authentication via the login screen.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
