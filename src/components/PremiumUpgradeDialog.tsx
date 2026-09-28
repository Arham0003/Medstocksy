import { Diamond, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Shown when someone reaches for a premium feature without the plan.
 * Kept generic via `feature` so later premium gates can reuse it rather than
 * growing a second dialog.
 */
export interface PremiumUpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Feature name used in the heading, e.g. "Wholesale Billing". */
  feature?: string;
  description?: string;
  /** Short selling points. Defaults to the wholesale set. */
  highlights?: string[];
}

const DEFAULT_HIGHLIGHTS = [
  'B2B invoicing with customer GSTIN on every bill',
  'Free Qty / scheme quantity per line',
  'A4 tax invoice and 3-inch thermal print',
  'Separate wholesale reports',
];

export function PremiumUpgradeDialog({
  open,
  onOpenChange,
  feature = 'Wholesale Billing',
  description = 'Enable B2B invoicing, free-qty schemes, and A4 tax invoices.',
  highlights = DEFAULT_HIGHLIGHTS,
}: PremiumUpgradeDialogProps) {
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
            <Diamond className="h-6 w-6 text-violet-600" />
          </div>
          <DialogTitle className="text-center text-xl pt-4">Unlock {feature}</DialogTitle>
          <DialogDescription className="text-center pt-2">{description}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 my-2 rounded-lg bg-violet-50/60 border border-violet-100 p-4">
          {highlights.map(item => (
            <li key={item} className="flex items-start gap-2 text-sm text-violet-900">
              <Check className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <DialogFooter className="sm:justify-center gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Not now
          </Button>
          <Button
            size="lg"
            className="w-full sm:w-auto bg-violet-600 hover:bg-violet-700"
            onClick={() => {
              onOpenChange(false);
              navigate('/pricing');
            }}
          >
            View Plans →
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PremiumUpgradeDialog;
