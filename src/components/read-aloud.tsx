"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";

/** Reads feedback aloud with the browser's own speech (free, on the device). Hidden where the browser can't speak. */
export function ReadAloud({ text, label = "Read aloud" }: { text: string; label?: string }) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);
  if (typeof window !== "undefined" && !("speechSynthesis" in window)) return null;
  return (
    <button type="button" aria-pressed={speaking}
      onClick={() => {
        const synth = window.speechSynthesis;
        if (speaking) { synth.cancel(); setSpeaking(false); return; }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en";
        u.rate = 0.95;
        u.onend = () => setSpeaking(false);
        u.onerror = () => setSpeaking(false);
        synth.cancel();
        synth.speak(u);
        setSpeaking(true);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-ruling bg-white px-3 py-1.5 text-[0.9rem] font-semibold hover:bg-secondary">
      {speaking ? <VolumeX aria-hidden className="size-4" /> : <Volume2 aria-hidden className="size-4" />} {speaking ? "Stop" : label}
    </button>
  );
}
