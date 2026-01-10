import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, LogIn, UserPlus, ShieldAlert, Loader2, ArrowRight } from 'lucide-react';

export default function Auth() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('mode');
  const isSignUp = mode === 'signup';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { signIn, signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/';

  // Ensure valid mode
  useEffect(() => {
    if (mode !== 'login' && mode !== 'signup') {
      setSearchParams({ mode: 'login' });
    }
  }, [mode, setSearchParams]);

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
        setError('Please check your email to confirm your account');
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

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await signInWithGoogle();
    } catch (err) {
      console.error('Google sign-in error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred during Google sign-in');
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setError(null);
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

              <Button
                variant="outline"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full h-11 relative overflow-hidden transition-all hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <div className="flex items-center justify-center w-full">
                    <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    Continue with Google
                  </div>
                )}
              </Button>

              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-200 dark:border-slate-800" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white dark:bg-slate-900 px-2 text-muted-foreground font-medium">
                    Or continue with email
                  </span>
                </div>
              </div>

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
                    className="h-10 bg-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-10 bg-transparent"
                  />
                </div>
                {isSignUp && (
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required={isSignUp}
                      className="h-10 bg-transparent"
                    />
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