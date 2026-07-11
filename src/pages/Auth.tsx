import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/db_conn/supabaseClient';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  LogIn,
  ShieldCheck,
  Loader2,
  ArrowRight,
  Eye,
  EyeOff,
  Mail,
  Lock,
  Building2,
  Package,
  Receipt,
  Users,
  LineChart,
  Check,
} from 'lucide-react';

const FEATURES = [
  { icon: Package, title: 'Smart Inventory', desc: 'Batch & expiry tracking with low-stock alerts' },
  { icon: Receipt, title: 'Lightning-fast Billing', desc: 'GST-ready invoices in seconds' },
  { icon: Users, title: 'Customer CRM', desc: 'Refill reminders & purchase history' },
  { icon: LineChart, title: 'Real-time Reports', desc: 'Sales, profit & stock insights at a glance' },
];

export default function Auth() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('mode');
  const isSignUp = mode === 'signup';
  const isResetPassword = mode === 'reset-password';
  const isUpdatePassword = mode === 'update-password';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const { signIn, signUp, resetPassword, updatePassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/';

  useEffect(() => {
    if (mode !== 'login' && mode !== 'signup' && mode !== 'reset-password' && mode !== 'update-password') {
      setSearchParams({ mode: 'login' });
    }
  }, [mode, setSearchParams]);

  // Handle Supabase password recovery event
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSearchParams({ mode: 'update-password' });
      } else if (session && !isUpdatePassword) {
        // If user is already logged in and NOT updating password, send them home
        navigate(from, { replace: true });
      }
    });

    return () => subscription.unsubscribe();
  }, [setSearchParams, isUpdatePassword, navigate, from]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Normalize email so trailing spaces / different casing can't create or
    // target the wrong account.
    const normalizedEmail = email.trim().toLowerCase();

    try {
      if (isSignUp) {
        if (!agreedToTerms) {
          throw new Error('Please agree to our Terms and Conditions to continue');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters long');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        const { error } = await signUp(normalizedEmail, password, companyName.trim());
        if (error) throw error;
        setMessage('Registration successful! Please check your email to verify your account.');
        // Clear sensitive fields after a successful sign-up.
        setPassword('');
        setConfirmPassword('');
      } else if (isResetPassword) {
        const { error } = await resetPassword(normalizedEmail);
        if (error) throw error;
        setMessage('Password reset link sent! Please check your email.');
      } else if (isUpdatePassword) {
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters long');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        const { error } = await updatePassword(password);
        if (error) throw error;
        setMessage('Password updated successfully! You can now sign in.');
        setPassword('');
        setConfirmPassword('');
        setTimeout(() => setSearchParams({ mode: 'login' }), 3000);
      } else {
        const { error } = await signIn(normalizedEmail, password);
        if (error) throw error;
        navigate(from, { replace: true });
      }
    } catch (err) {
      console.error('Authentication error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred during authentication');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setError(null);
    setMessage(null);
    setSearchParams({ mode: isSignUp ? 'login' : 'signup' });
  };

  const headings = {
    title: isSignUp
      ? 'Create your account'
      : isResetPassword
        ? 'Reset your password'
        : isUpdatePassword
          ? 'Set a new password'
          : 'Welcome back',
    subtitle: isSignUp
      ? 'Set up your pharmacy in minutes — no card required.'
      : isResetPassword
        ? "Enter your email and we'll send you a reset link."
        : isUpdatePassword
          ? 'Choose a strong new password to secure your account.'
          : 'Sign in to manage your pharmacy inventory & sales.',
    cta: isSignUp
      ? 'Create Account'
      : isResetPassword
        ? 'Send Reset Link'
        : isUpdatePassword
          ? 'Update Password'
          : 'Sign In',
  };

  return (
    <div className="min-h-[calc(100vh/0.9)] relative overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Animated gradient background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none motion-reduce:*:animate-none">
        <div className="absolute top-[-15%] left-[-10%] w-[55%] h-[55%] rounded-full bg-primary/25 blur-[120px] animate-blob-one" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[55%] h-[55%] rounded-full bg-blue-500/25 blur-[120px] animate-blob-two" />
        <div className="absolute top-[35%] left-[45%] w-[35%] h-[35%] rounded-full bg-purple-500/15 blur-[120px] animate-blob-one [animation-delay:5s]" />
      </div>

      <div className="relative z-10 grid lg:grid-cols-2 min-h-[calc(100vh/0.9)]">
        {/* ============ LEFT — Brand showcase (desktop only) ============ */}
        <aside className="hidden lg:flex flex-col justify-between p-12 xl:p-16">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-primary to-blue-600 p-2.5 rounded-2xl shadow-lg shadow-primary/25">
              <ShieldCheck className="h-7 w-7 text-white" />
            </div>
            <span className="text-2xl font-bold tracking-tight">Medstocksy</span>
          </div>

          {/* Headline + feature glass cards */}
          <div className="space-y-8 max-w-lg">
            <div className="space-y-4">
              <h1 className="text-4xl xl:text-5xl font-bold leading-tight tracking-tight">
                Run your pharmacy,{' '}
                <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
                  end to end
                </span>
              </h1>
              <p className="text-lg text-slate-600 dark:text-slate-400">
                Inventory, GST billing, customers and reports — one fast, modern platform built for Indian pharmacies.
              </p>
            </div>

            <ul className="grid gap-3">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <li
                  key={title}
                  className="flex items-start gap-4 rounded-2xl border border-white/40 dark:border-white/10 bg-white/50 dark:bg-white/5 backdrop-blur-md p-4 shadow-sm transition-colors hover:bg-white/70 dark:hover:bg-white/10"
                >
                  <div className="shrink-0 rounded-xl bg-primary/10 text-primary p-2.5">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold leading-tight">{title}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer trust line */}
          <p className="text-sm text-slate-500 dark:text-slate-500">
            &copy; {new Date().getFullYear()} Medstocksy. All rights reserved.
          </p>
        </aside>

        {/* ============ RIGHT — Auth form ============ */}
        <main className="flex items-center justify-center p-4 sm:p-6 lg:p-10">
          <div className="w-full max-w-md">
            {/* Mobile brand (hidden on desktop where the left panel shows it) */}
            <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
              <div className="bg-gradient-to-br from-primary to-blue-600 p-2.5 rounded-2xl shadow-lg shadow-primary/25">
                <ShieldCheck className="h-6 w-6 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight">Medstocksy</span>
            </div>

            {/* Glass card */}
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/40 to-blue-600/40 rounded-3xl blur opacity-30 group-hover:opacity-50 transition duration-1000" />

              <div className="relative rounded-3xl border border-white/50 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 backdrop-blur-2xl shadow-2xl p-6 sm:p-8">
                {/* Sign in / Sign up segmented switch (hidden for reset/update flows) */}
                {!isResetPassword && !isUpdatePassword && (
                  <div className="mb-6 grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/60 dark:bg-slate-800/60 p-1">
                    <button
                      type="button"
                      onClick={() => !isSignUp || toggleMode()}
                      className={`rounded-xl py-2 text-sm font-semibold transition-all ${
                        !isSignUp
                          ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      onClick={() => isSignUp || toggleMode()}
                      className={`rounded-xl py-2 text-sm font-semibold transition-all ${
                        isSignUp
                          ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      Sign Up
                    </button>
                  </div>
                )}

                {/* Heading */}
                <div className="mb-6 space-y-1.5">
                  <h2 className="text-2xl font-bold tracking-tight">{headings.title}</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{headings.subtitle}</p>
                </div>

                {/* Alerts */}
                {error && (
                  <Alert variant="destructive" className="mb-4 animate-in fade-in slide-in-from-top-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {message && (
                  <Alert className="mb-4 bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800 animate-in fade-in slide-in-from-top-2">
                    <Check className="h-4 w-4" />
                    <AlertDescription>{message}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleEmailAuth} className="space-y-4">
                  {isSignUp && (
                    <div className="space-y-1.5">
                      <Label htmlFor="company">Pharmacy / Company name</Label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                        <Input
                          id="company"
                          placeholder="MedPlus Pharmacy"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          required={isSignUp}
                          className="h-11 pl-10 bg-white/60 dark:bg-slate-800/60"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="name@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={isUpdatePassword}
                        className="h-11 pl-10 bg-white/60 dark:bg-slate-800/60"
                      />
                    </div>
                  </div>

                  {!isResetPassword && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="password">{isUpdatePassword ? 'New password' : 'Password'}</Label>
                        {!isUpdatePassword && !isSignUp && (
                          <button
                            type="button"
                            onClick={() => setSearchParams({ mode: 'reset-password' })}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                        <Input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="h-11 pl-10 pr-10 bg-white/60 dark:bg-slate-800/60"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors focus:outline-none"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {(isSignUp || isUpdatePassword) && (
                        <p className="text-xs text-slate-500 dark:text-slate-500">At least 6 characters.</p>
                      )}
                    </div>
                  )}

                  {(isSignUp || isUpdatePassword) && (
                    <div className="space-y-1.5">
                      <Label htmlFor="confirmPassword">
                        {isUpdatePassword ? 'Confirm new password' : 'Confirm password'}
                      </Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                        <Input
                          id="confirmPassword"
                          type={showConfirmPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          className="h-11 pl-10 pr-10 bg-white/60 dark:bg-slate-800/60"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors focus:outline-none"
                        >
                          {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {isSignUp && (
                    <label htmlFor="terms" className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        id="terms"
                        type="checkbox"
                        checked={agreedToTerms}
                        onChange={(e) => setAgreedToTerms(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-400 accent-primary"
                      />
                      <span className="text-sm leading-snug text-slate-600 dark:text-slate-400">
                        I agree to the{' '}
                        <a
                          href="/assets/terms.html"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Terms &amp; Conditions
                        </a>
                      </span>
                    </label>
                  )}

                  <Button
                    type="submit"
                    disabled={isLoading || (isSignUp && !agreedToTerms)}
                    className="w-full h-11 text-base font-semibold bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90 shadow-lg shadow-primary/20 transition-all duration-300 hover:scale-[1.02]"
                  >
                    {isLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        {headings.cta}
                        {mode === 'login' || !mode ? (
                          <LogIn className="ml-2 h-4 w-4" />
                        ) : (
                          <ArrowRight className="ml-2 h-4 w-4" />
                        )}
                      </>
                    )}
                  </Button>
                </form>

                {/* Footer action */}
                <div className="mt-6 text-center text-sm">
                  {isResetPassword || isUpdatePassword ? (
                    <button
                      type="button"
                      onClick={() => setSearchParams({ mode: 'login' })}
                      className="font-medium text-primary hover:underline"
                    >
                      ← Back to sign in
                    </button>
                  ) : (
                    <span className="text-slate-600 dark:text-slate-400">
                      {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
                      <button type="button" onClick={toggleMode} className="font-semibold text-primary hover:underline">
                        {isSignUp ? 'Sign in' : 'Create one'}
                      </button>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Mobile copyright */}
            <p className="lg:hidden mt-8 text-center text-xs text-slate-500 dark:text-slate-500">
              &copy; {new Date().getFullYear()} Medstocksy. All rights reserved.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
