"use client";

import { useEffect } from "react";

interface ToastProps {
  type: "success" | "error";
  message: string;
  onClose: () => void;
}

export function Toast({ type, message, onClose }: ToastProps) {
  useEffect(() => {
    const id = setTimeout(onClose, 4000);
    return () => clearTimeout(id);
  }, [onClose]);

  const dot = type === "success" ? "bg-emerald-500" : "bg-red-500";

  return (
    <div
      className="fixed right-4 top-4 z-50 flex max-w-sm items-start gap-3 rounded-xl bg-white px-4 py-3 shadow-lg shadow-slate-300/40 ring-1 ring-slate-200"
      role="alert"
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="flex-1 text-sm text-slate-700">{message}</span>
      <button
        onClick={onClose}
        className="ml-1 text-slate-400 transition-colors hover:text-slate-600"
        aria-label="Schließen"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
