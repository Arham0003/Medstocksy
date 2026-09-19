import { Diamond } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * 💎 marker for a spot that a wholesale plan unlocks. Clicking goes to the
 * plans page. Used wherever a feature is visible but locked.
 */
export function PremiumBadge({
  className,
  label = 'Premium',
  title = 'Premium feature — upgrade to the Wholesale plan',
  interactive = true,
}: {
  className?: string;
  /** Set to '' for an icon-only badge (tight spots like a sidebar row). */
  label?: string;
  title?: string;
  /**
   * false renders a plain <span>. Required when the badge sits inside another
   * link or button — a nested <button> is invalid HTML and swallows the row's
   * own click target.
   */
  interactive?: boolean;
}) {
  const navigate = useNavigate();

  const base = cn(
    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0',
    'bg-violet-100 text-violet-600',
    interactive && 'hover:bg-violet-200 transition-colors',
    className
  );

  if (!interactive) {
    return (
      <span title={title} aria-label={title} className={base}>
        <Diamond className="h-3 w-3" />
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={e => {
        // Stops the badge from also triggering the row/link it sits inside.
        e.preventDefault();
        e.stopPropagation();
        navigate('/pricing');
      }}
      className={base}
    >
      <Diamond className="h-3 w-3" />
      {label}
    </button>
  );
}

export default PremiumBadge;
