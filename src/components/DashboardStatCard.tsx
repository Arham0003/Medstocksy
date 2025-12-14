import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface DashboardStatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  variant?: "default" | "success" | "warning" | "danger" | "info" | "primary";
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

const variantStyles = {
  default: {
    bg: "bg-white",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-600",
    textColor: "text-slate-900",
    borderColor: "border-slate-200",
    gradient: "from-white to-slate-50"
  },
  success: {
    bg: "bg-emerald-50",
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    textColor: "text-emerald-700",
    borderColor: "border-emerald-200",
    gradient: "from-emerald-50 to-white"
  },
  warning: {
    bg: "bg-amber-50",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    textColor: "text-amber-700",
    borderColor: "border-amber-200",
    gradient: "from-amber-50 to-white"
  },
  danger: {
    bg: "bg-rose-50",
    iconBg: "bg-rose-100",
    iconColor: "text-rose-600",
    textColor: "text-rose-700",
    borderColor: "border-rose-200",
    gradient: "from-rose-50 to-white"
  },
  info: {
    bg: "bg-blue-50",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    textColor: "text-blue-700",
    borderColor: "border-blue-200",
    gradient: "from-blue-50 to-white"
  },
  primary: {
    bg: "bg-indigo-50",
    iconBg: "bg-indigo-100",
    iconColor: "text-indigo-600",
    textColor: "text-indigo-700",
    borderColor: "border-indigo-200",
    gradient: "from-indigo-50 to-white"
  }
};

export const DashboardStatCard = ({
  title,
  value,
  icon: Icon,
  description,
  variant = "default",
  loading = false,
  onClick,
  className
}: DashboardStatCardProps) => {
  const styles = variantStyles[variant];

  return (
    <Card
      onClick={onClick}
      className={cn(
        "relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 border",
        styles.borderColor,
        onClick && "cursor-pointer",
        className
      )}
    >
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-50", styles.gradient)} />

      <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          {description && (
            <CardDescription className="text-xs truncate max-w-[180px]">
              {description}
            </CardDescription>
          )}
        </div>
        <div className={cn("p-2.5 rounded-xl transition-colors", styles.iconBg)}>
          <Icon className={cn("h-5 w-5", styles.iconColor)} />
        </div>
      </CardHeader>

      <CardContent className="relative">
        <div className={cn("text-2xl font-bold tracking-tight", styles.textColor)}>
          {loading ? (
            <div className="h-8 w-24 bg-slate-200 animate-pulse rounded" />
          ) : (
            value
          )}
        </div>
      </CardContent>
    </Card>
  );
};
