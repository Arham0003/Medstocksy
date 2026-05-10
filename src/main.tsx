import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Dev-only: filter noisy or non-actionable console warnings/errors
if (import.meta.env.DEV) {
	const origWarn = console.warn.bind(console);
	const origError = console.error.bind(console);

	const shouldIgnore = (msg: string) => {
		if (!msg) return false;
		const s = msg.toString();
		return (
			s.includes('React Router Future Flag Warning') ||
			s.includes('v7_startTransition') ||
			s.includes('v7_relativeSplatPath') ||
			s.includes('Unchecked runtime.lastError') ||
			s.includes('Manifest: Line') ||
			s.includes('Download the React DevTools')
		);
	};

	console.warn = (...args: any[]) => {
		try {
			const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
			if (shouldIgnore(text)) return;
		} catch (_) {}
		origWarn(...args);
	};

	console.error = (...args: any[]) => {
		try {
			const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
			if (shouldIgnore(text)) return;
		} catch (_) {}
		origError(...args);
	};
}

// During development (or when `?no-sw` is present) we intentionally
// unregister any previously-installed service workers so Workbox logs
// and cached assets don't interfere with the dev experience.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
	try {
		const url = new URL(window.location.href);
		const disableSW = import.meta.env.DEV || url.searchParams.has('no-sw');
		if (disableSW) {
			navigator.serviceWorker.getRegistrations().then(regs => {
				regs.forEach(r => r.unregister().catch(() => {}));
			}).catch(() => {});
		}
	} catch (e) {
		// ignore URL parsing errors
	}
}

// Service-worker registration is handled inside <PWAPrompts /> in `App`,
// but that component will only register the SW in production (see its file).
createRoot(document.getElementById("root")!).render(<App />);