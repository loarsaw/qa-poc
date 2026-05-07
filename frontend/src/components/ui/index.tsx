import { cn } from "@/lib/utils/index";

const badgeVariants: Record<string, string> = {
  pending: "bg-amber-light text-amber border border-amber/20",
  processing: "bg-blue-light  text-blue  border border-blue/20",
  completed: "bg-green-light text-green  border border-green/20",
  failed: "bg-red-light   text-red    border border-red/20",
  text: "bg-accent-light text-accent border border-accent/20",
  audio: "bg-purple-light text-purple border border-purple/20",
  video: "bg-amber-light  text-amber  border border-amber/20",
  pdf: "bg-red-light    text-red    border border-red/20",
};

export function Badge({
  variant,
  children,
  className,
}: {
  variant: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold",
        badgeVariants[variant] ??
          "bg-surface3 text-muted2 border border-border",
        className,
      )}
    >
      {children}
    </span>
  );
}

type BtnVariant = "primary" | "ghost" | "danger" | "subtle";
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border-0";
const btnVariants: Record<BtnVariant, string> = {
  primary: "bg-accent hover:bg-accent-hover text-white px-4 py-2",
  ghost:
    "bg-transparent hover:bg-surface3 text-muted2 hover:text-text border border-border hover:border-border2 px-4 py-2",
  danger:
    "bg-red-light hover:bg-red/20 text-red border border-red/20 px-4 py-2",
  subtle: "bg-surface2 hover:bg-surface3 text-text px-4 py-2",
};

export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: {
  variant?: BtnVariant;
  className?: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn(btnBase, btnVariants[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function Spinner({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border-2 border-border2 border-t-accent animate-spin-slow",
        className,
      )}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  );
}

export function Empty({
  icon,
  title,
  sub,
}: {
  icon: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-3 text-muted">
      <span className="text-4xl opacity-40">{icon}</span>
      <p className="text-sm text-muted2 font-medium">{title}</p>
      {sub && <p className="text-xs text-muted max-w-xs text-center">{sub}</p>}
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-surface border border-border rounded-xl overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Modal({
  onClose,
  children,
  className,
}: {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6"
      onClick={onClose}
    >
      <div
        className={cn(
          "bg-surface border border-border2 rounded-2xl p-6 w-full max-w-lg flex flex-col gap-5 shadow-2xl animate-fade-up",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
