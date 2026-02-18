import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, LogIn, UserPlus, ShieldAlert, Loader2, ArrowRight, Eye, EyeOff } from 'lucide-react';

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

    try {
      if (isSignUp) {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        const { error } = await signUp(email, password, companyName);
        if (error) throw error;
        setMessage('Registration successful! Please check your email to verify your account.');
      } else if (isResetPassword) {
        const { error } = await resetPassword(email);
        if (error) throw error;
        setMessage('Password reset link sent! Please check your email.');
      } else if (isUpdatePassword) {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        const { error } = await updatePassword(password);
        if (error) throw error;
        setMessage('Password updated successfully! You can now sign in.');
        setTimeout(() => setSearchParams({ mode: 'login' }), 3000);
      } else {
        const { error } = await signIn(email, password);
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

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Dynamic Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] px-10 left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/20 blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/20 blur-[100px]" />
      </div>

      <div className="w-full max-w-md z-10 px-4">
        <div className="max-w-md mx-auto relative group">
          {/* Glassmorphism Card */}
          <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/50 to-blue-600/50 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>

          <Card className="relative bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-slate-200/50 dark:border-slate-800/50 shadow-xl">
            <CardHeader className="space-y-1 text-center pb-8">
              <div className="flex justify-center mb-6">
                <div className="bg-gradient-to-br from-primary to-blue-600 p-3 rounded-2xl shadow-lg shadow-primary/25">
                  <ShieldAlert className="h-8 w-8 text-white" />
                </div>
              </div>

              {isSignUp ? (
                <>
                  <CardTitle className="text-2xl font-bold tracking-tight bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                    Create your Medstocksy account
                  </CardTitle>
                  <CardDescription className="text-base mt-2">
                    Set up your pharmacy inventory and CRM in minutes
                  </CardDescription>
                </>
              ) : isResetPassword ? (
                <>
                  <CardTitle className="text-2xl font-bold tracking-tight">
                    Reset Password
                  </CardTitle>
                  <CardDescription className="text-base">
                    Enter your email to receive a reset link
                  </CardDescription>
                </>
              ) : isUpdatePassword ? (
                <>
                  <CardTitle className="text-2xl font-bold tracking-tight">
                    Update Password
                  </CardTitle>
                  <CardDescription className="text-base">
                    Enter your new password below
                  </CardDescription>
                </>
              ) : (
                <>
                  <CardTitle className="text-2xl font-bold tracking-tight">
                    Welcome back
                  </CardTitle>
                  <CardDescription className="text-base">
                    Enter your credentials to access your account
                  </CardDescription>
                </>
              )}
            </CardHeader>

            <CardContent className="grid gap-4">
              {error && (
                <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {message && (
                <Alert className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800 animate-in fade-in slide-in-from-top-2">
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleEmailAuth} className="space-y-4">
                {isSignUp && (
                  <div className="space-y-2">
                    <Label htmlFor="company">Company Name</Label>
                    <Input
                      id="company"
                      placeholder="MedPharmacy Example"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      required={isSignUp}
                      className="h-10 bg-transparent"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isUpdatePassword}
                    className="h-10 bg-transparent"
                  />
                </div>
                {!isResetPassword && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">
                        {isUpdatePassword ? "New Password" : "Password"}
                      </Label>
                      {!isUpdatePassword && !isSignUp && (
                        <Button
                          variant="link"
                          className="px-0 font-normal h-auto text-xs"
                          type="button"
                          onClick={() => setSearchParams({ mode: 'reset-password' })}
                        >
                          Forgot password?
                        </Button>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="h-10 bg-transparent pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors focus:outline-none"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
                {(isSignUp || isUpdatePassword) && (
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">
                      {isUpdatePassword ? "Confirm New Password" : "Confirm Password"}
                    </Label>
                    <div className="relative">
                      <Input
                        id="confirmPassword"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        className="h-10 bg-transparent pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors focus:outline-none"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90 shadow-md transition-all duration-300 transform hover:scale-[1.02]"
                >
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : isSignUp ? (
                    <>
                      Create Account <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  ) : isResetPassword ? (
                    <>
                      Send Reset Link <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  ) : isUpdatePassword ? (
                    <>
                      Update Password <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  ) : (
                    <>
                      Sign In <LogIn className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            </CardContent>

            <CardFooter className="flex flex-col pt-0 pb-8">
              <Button
                variant="link"
                onClick={toggleMode}
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                {isSignUp
                  ? "Already have an account? Sign in"
                  : isResetPassword || isUpdatePassword
                    ? "Back to login"
                    : "New here? Create an account"}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Simple Footer/Copyright */}
        <div className="mt-8 text-center text-sm text-muted-foreground opacity-60">
          &copy; {new Date().getFullYear()} Medstocksy. All rights reserved.
        </div>
      </div>
    </div>
  );
}