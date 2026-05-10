import { Skeleton } from '@/components/ui/skeleton';

interface TableSkeletonProps {
  /** Number of skeleton rows to render */
  rows?: number;
  /** One Tailwind width class per column (e.g. ['w-32', 'w-24', 'w-12']) */
  cols: string[];
  /** Optional Tailwind class on the outer wrapper */
  className?: string;
}

/**
 * Lightweight, shape-aware skeleton for table content while loading.
 * Pass `cols` to roughly match the real table's column widths.
 */
export function TableSkeleton({ rows = 5, cols, className = '' }: TableSkeletonProps) {
  return (
    <div className={`space-y-0 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3 border-b last:border-b-0">
          {cols.map((w, j) => (
            <Skeleton key={j} className={`h-4 ${w}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
