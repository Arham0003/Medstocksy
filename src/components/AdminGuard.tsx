import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Eye, EyeOff, Lock, AlertTriangle } from 'lucide-react';

// ──────────────────────────────────────────────────────────────
// IMPORTANT: These credentials live in the frontend JS bundle and
// are readable by anyone who inspects the deployed code. They are
// a soft gate — they keep casual users out of the admin panel, but
// they are NOT a substitute for proper server-side authorization.
// For real protection, enforce admin checks via Supabase RLS / RPC
// using the logged-in user's identity.
// ──────────────────────────────────────────────────────────────
const ADMIN_USER = 'conact@medstocksy.in';
const ADMIN_PASS = 'Med1!stocksy2@';

const STORAGE_KEY = 'medstocksy:admin_unlocked';
const COOLDOWN_KEY = 'medstocksy:admin_cooldown_until';
const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  });
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    return parseInt(sessionStorage.getItem(COOLDOWN_KEY) || '0', 10);
  });
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick `now` every second while in cooldown so the countdown updates
  useEffect(() => {
    if (cooldownUntil <= now) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil, now]);

  const cooldownRemaining = Math.max(0, cooldownUntil - now);
  const onCooldown = cooldownRemaining > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onCooldown) return;

    if (user.trim().toLowerCase() === ADMIN_USER.toLowerCase() && pass === ADMIN_PASS) {
      sessionStorage.setItem(STORAGE_KEY, '1');
      sessionStorage.removeItem(COOLDOWN_KEY);
      setUnlocked(true);
      setError('');
      setAttempts(0);
      setUser('');
      setPass('');
      return;
    }

    const next = attempts + 1;
    setAttempts(next);
    setPass('');
    if (next >= MAX_ATTEMPTS_BEFORE_COOLDOWN) {
      const until = Date.now() + COOLDOWN_MS;
      sessionStorage.setItem(COOLDOWN_KEY, String(until));
      setCooldownUntil(until);
      setError('Too many failed attempts. Try again later.');
    } else {
      setError(`Incorrect ID or password. ${MAX_ATTEMPTS_BEFORE_COOLDOWN - next} attempt(s) left.`);
    }
  };

  const handleLock = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setUnlocked(false);
    setUser('');
    setPass('');
  };

  if (unlocked) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 print:hidden">
          <div className="flex items-center gap-2 text-xs text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Admin session unlocked.</span>
          </div>
          <button
            type="button"
            onClick={handleLock}
            className="text-xs text-emerald-700 hover:text-emerald-900 hover:underline inline-flex items-center gap-1"
          >
            <Lock className="h-3 w-3" />
            Lock admin
          </button>
        </div>
        {children}
      </div>
    );
  }

  // Format cooldown remaining as MM:SS
  const mins = Math.floor(cooldownRemaining / 60000);
  const secs = Math.floor((cooldownRemaining % 60000) / 1000).toString().padStart(2, '0');

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md shadow-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-slate-900 text-white flex items-center justify-center">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Admin access required</CardTitle>
          <CardDescription>
            This area is restricted. Enter the admin ID and password to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="admin-id" className="text-xs font-semibold text-slate-700">Admin ID</Label>
              <Input
                id="admin-id"
                type="email"
                autoComplete="off"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="name@example.com"
                disabled={onCooldown}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-pass" className="text-xs font-semibold text-slate-700">Password</Label>
              <div className="relative">
                <Input
                  id="admin-pass"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  className="pr-9"
                  disabled={onCooldown}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-slate-900 hover:bg-slate-800"
              disabled={onCooldown || !user || !pass}
            >
              {onCooldown ? `Locked · retry in ${mins}:${secs}` : 'Unlock admin panel'}
            </Button>

            <p className="text-[11px] text-muted-foreground text-center">
              Sessions stay unlocked until you close the tab or click <strong>Lock admin</strong>.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
