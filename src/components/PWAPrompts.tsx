import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast } from 'sonner';
import { Download, Share, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Types ────────────────────────────────────────────────────
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const INSTALL_DISMISSED_KEY = 'medstocksy:pwa_install_dismissed_until';
const DISMISS_COOLDOWN_DAYS = 7;

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari sets navigator.standalone
  if ((window.navigator as any).standalone === true) return true;
  return false;
}

function isIOSDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) && !(window as any).MSStream;
}

// ─── Component ────────────────────────────────────────────────
export default function PWAPrompts() {
  // 1. Service worker registration + update detection
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    // Only register the service worker in production builds. During
    // development we prefer no SW to avoid verbose Workbox logs and cache
    // interference. Use `?no-sw` to explicitly disable if needed.
    immediate: import.meta.env.PROD,
    onRegisterError(err) {
      console.error('[PWA] SW registration error:', err);
    },
  });

  // 2. Install prompt state
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  // ── Update toast: triggered when a new SW is waiting ─────────
  useEffect(() => {
    if (!needRefresh) return;
    const id = toast('Update available', {
      description: 'A newer version of Medstocksy is ready.',
      duration: Infinity,
      action: {
        label: 'Reload',
        onClick: () => {
          updateServiceWorker(true);
        },
      },
      cancel: {
        label: 'Later',
        onClick: () => setNeedRefresh(false),
      },
    });
    return () => { toast.dismiss(id); };
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);

  // ── One-time "ready offline" toast ───────────────────────────
  useEffect(() => {
    if (!offlineReady) return;
    toast('Ready for offline use', {
      description: 'Medstocksy can now load without a network connection.',
      duration: 4000,
    });
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady]);

  // ── Install prompt wiring ────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone()) return; // already installed

    const dismissedUntil = parseInt(localStorage.getItem(INSTALL_DISMISSED_KEY) || '0', 10);
    if (Date.now() < dismissedUntil) return;

    // iOS doesn't support beforeinstallprompt — show the manual hint instead
    if (isIOSDevice()) {
      const t = setTimeout(() => {
        setIosHint(true);
        setShowInstall(true);
      }, 3000); // give the page a moment to settle
      return () => clearTimeout(t);
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShowInstall(true);
    };

    const onAppInstalled = () => {
      setShowInstall(false);
      setDeferred(null);
      toast('Medstocksy installed', { description: 'Open it any time from your home screen.' });
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const dismissInstall = () => {
    setShowInstall(false);
    localStorage.setItem(
      INSTALL_DISMISSED_KEY,
      String(Date.now() + DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000),
    );
  };

  const handleInstall = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') {
        setShowInstall(false);
      } else {
        dismissInstall();
      }
    } catch (err) {
      console.error('[PWA] install prompt failed:', err);
    } finally {
      setDeferred(null);
    }
  };

  if (!showInstall) return null;

  // ── Install banner (renders only when prompt is available or on iOS) ──
  return (
    <div
      role="dialog"
      aria-label="Install Medstocksy"
      className="fixed left-1/2 -translate-x-1/2 bottom-4 z-[60] w-[calc(100%-1.5rem)] max-w-md
                 bg-white border border-slate-200 shadow-xl rounded-xl px-3 py-3
                 flex items-start gap-3"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="bg-orange-100 p-2 rounded-lg shrink-0">
        <Download className="h-4 w-4 text-orange-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-slate-900">
          {iosHint ? 'Add Medstocksy to your home screen' : 'Install Medstocksy'}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          {iosHint ? (
            <span className="inline-flex items-center gap-1 flex-wrap">
              Tap <Share className="h-3 w-3 inline" /> Share, then <strong>Add to Home Screen</strong>.
            </span>
          ) : (
            'Open it like a regular app — works offline, no browser tabs.'
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!iosHint && (
          <Button
            size="sm"
            onClick={handleInstall}
            className="h-8 bg-orange-600 hover:bg-orange-700 text-white"
          >
            Install
          </Button>
        )}
        <Button
          size="icon" variant="ghost"
          onClick={dismissInstall}
          className="h-8 w-8 text-slate-500 hover:text-slate-700"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
