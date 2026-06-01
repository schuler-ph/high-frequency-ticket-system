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

  const colors =
    type === "success" ? "bg-[#FFE600] text-zinc-950" : "bg-red-500 text-white";

  return (
    <div
      className={`fixed top-4 right-4 z-50 flex items-start gap-3 px-5 py-4 font-mono text-sm uppercase tracking-wide shadow-lg max-w-sm ${colors}`}
      role="alert"
    >
      <span className="flex-1">{message}</span>
      <button
        onClick={onClose}
        className="ml-2 font-black opacity-60 hover:opacity-100"
        aria-label="Schließen"
      >
        ✕
      </button>
    </div>
  );
}
