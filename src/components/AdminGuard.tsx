import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Eye, EyeOff, Lock, AlertTriangle, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/supabaseLoose';
import { useAuth } from '@/hooks/useAuth';

// ──────────────────────────────────────────────────────────────
// IMPORTANT: These credentials live in the frontend JS bundle and
// are readable by anyone who inspects the deployed code. They are
// a soft gate — they keep casual users out of the admin panel, but
// they are NOT the security boundary.
//
// The real boundary is server-side: every admin_* RPC calls
// require_platform_admin() and raises 42501 for anyone whose login
// email is not in public.admin_users (20260919000000_admin_panel.sql).
// The check below mirrors that server answer so the UI can say so
// plainly instead of rendering a panel whose every call would fail.
// ──────────────────────────────────────────────────────────────
const ADMIN_USER = 'contact@medstocksy.in';
const ADMIN_PASS = 'Med1!stocksy2@';

const STORAGE_KEY = 'medstocksy:admin_unlocked';
const COOLDOWN_KEY = 'medstocksy:admin_cooldown_until';
const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  // The email the server compares against admin_users — NOT the ID typed below.
  const { user: authUser, profile } = useAuth();
  const signedInEmail = profile?.email || authUser?.email || '';
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

  // Server's verdict on whether this login is a platform admin.
  //   null      = still checking
  //   true      = confirmed admin
  //   false     = the server said NO — the only case that blocks
  //   'unknown' = the check could not run (migration missing, offline…).
  //
  // Only a definitive `false` blocks. Anything else fails OPEN with a banner:
  // the admin_* RPCs each enforce require_platform_admin() themselves, so this
  // check is for explaining the situation, not for holding the door.
  const [serverAdmin, setServerAdmin] = useState<boolean | 'unknown' | null>(null);
  const [checkError, setCheckError] = useState<string>('');
  const [recheck, setRecheck] = useState(0);

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    setServerAdmin(null);
    (async () => {
      try {
        const { data, error } = await db.rpc('is_platform_admin');
        if (cancelled) return;
        if (error) {
          setCheckError(error.message || 'The admin check could not run.');
          setServerAdmin('unknown');
          return;
        }
        setCheckError('');
        setServerAdmin(data === true);
      } catch (e) {
        if (cancelled) return;
        setCheckError(e instanceof Error ? e.message : 'The admin check could not run.');
        setServerAdmin('unknown');
      }
    })();
    return () => { cancelled = true; };
  }, [unlocked, recheck]);

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
    // The signed-in account is not on the server's admin list. Every admin
    // RPC would reject it, so say that once instead of failing per action.
    if (serverAdmin === false) {
      const sql = `INSERT INTO public.admin_users (email, note)
VALUES ('${signedInEmail || 'your-login@example.com'}', 'admin')
ON CONFLICT (email) DO NOTHING;`;
      return (
        <div className="min-h-[60vh] flex items-center justify-center px-4 py-8">
          <Card className="w-full max-w-xl shadow-md border-amber-200">
            <CardHeader className="space-y-2 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl">This login isn't on the admin list</CardTitle>
              <CardDescription>
                The password was accepted. The admin list is checked against the account you are
                <strong> signed into the app with</strong> — not the ID typed on the unlock screen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-slate-50 px-3 py-2.5 text-sm">
                <div className="text-xs text-muted-foreground">Signed in as</div>
                <div className="font-medium text-slate-900 break-all">
                  {signedInEmail || 'unknown — no session'}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-slate-700">
                  Either sign out and sign back in as an admin account, or add this address to the
                  admin list by running this once in the Supabase SQL editor:
                </p>
                <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">{sql}</pre>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  className="w-full sm:flex-1"
                  onClick={() => setRecheck(n => n + 1)}
                >
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  Check again
                </Button>
                <Button variant="outline" className="w-full sm:w-auto" onClick={handleLock}>
                  <Lock className="h-4 w-4 mr-2" />
                  Lock admin
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 print:hidden">
          <div className="flex items-center gap-2 text-xs text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>
              Admin session unlocked
              {serverAdmin === null ? ' — verifying…' : serverAdmin === true ? ' and verified.' : '.'}
            </span>
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

        {serverAdmin === 'unknown' && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:hidden">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Couldn't confirm admin rights, so this panel is showing behind the password alone.
              If the admin SQL hasn't been run yet, apply <strong>supabase/APPLY_ALL_admin.sql</strong>.
              Individual actions may still be refused by the server.
              {checkError && <span className="block mt-1 opacity-75 break-all">{checkError}</span>}
            </span>
          </div>
        )}

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
