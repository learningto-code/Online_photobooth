"use client";

import { cn } from "@/lib/utils";

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
        {title}
      </h2>
      {children}
    </div>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

export function Chip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-40",
        active
          ? "border-pink-400 bg-pink-400/15 text-white"
          : "border-white/10 bg-white/5 text-white/70 hover:border-white/25",
      )}
    >
      {children}
    </button>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center text-white/70">
      {children}
    </div>
  );
}
