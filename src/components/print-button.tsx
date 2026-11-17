"use client";

export function PrintButton({ count }: { count: number }) {
  return (
    <button type="button" disabled={!count} onClick={() => window.print()} className="rounded-md bg-redpen px-4 py-2 font-semibold text-white hover:bg-[#b81f1f] disabled:opacity-50">
      Print {count} page{count === 1 ? "" : "s"}
    </button>
  );
}
