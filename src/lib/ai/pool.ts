import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText, NoObjectGeneratedError, Output, RetryError, type ModelMessage } from "ai";
import type { z } from "zod";

/**
 * Free-model pool. Every task lists the models it may use, best first. When a model hits its free-tier limit
 * (HTTP 429) or is unavailable, it is benched until its quota resets and the next one answers.
 *
 *  - vision tasks (reading handwriting): Gemini models, each with its own free daily quota, then free OpenRouter vision models
 *  - text tasks (rubrics, grading, feedback, insights): Groq (large free daily quota) first, then Gemini, then OpenRouter
 */

type ProviderId = "gemini" | "groq" | "openrouter";
export type Candidate = { provider: ProviderId; model: string };
export type Task = "read" | "grade" | "text";

const keys = (name: string) =>
  (process.env[name] ?? "").split(",").map((k) => k.trim()).filter(Boolean);

const KEYS: Record<ProviderId, string[]> = {
  gemini: keys("GEMINI_API_KEYS"),
  groq: keys("GROQ_API_KEYS"),
  openrouter: keys("OPENROUTER_API_KEYS"),
};

const GEMINI_VISION = [
  "gemini-3-flash-preview", // best at handwriting + line boxes in our spikes
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];
const OPENROUTER_VISION = ["nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-31b-it:free"];

export const ROUTES: Record<Task, Candidate[]> = {
  read: [
    ...GEMINI_VISION.map((model) => ({ provider: "gemini" as const, model })),
    ...OPENROUTER_VISION.map((model) => ({ provider: "openrouter" as const, model })),
  ],
  // Text tasks alternate providers so a second grading lands on a different model family. Groq models each have
  // their own limits (≈1000 requests/day, 8k tokens/min); Gemini lite models keep the vision models' quota free.
  grade: [
    { provider: "groq", model: "openai/gpt-oss-120b" },
    { provider: "gemini", model: "gemini-3.5-flash-lite" },
    { provider: "groq", model: "qwen/qwen3.8-27b" },
    { provider: "gemini", model: "gemini-3.1-flash-lite" },
    { provider: "groq", model: "openai/gpt-oss-20b" },
    { provider: "gemini", model: "gemini-flash-lite-latest" },
    { provider: "gemini", model: "gemini-3.6-flash" },
    { provider: "gemini", model: "gemini-3.5-flash" },
    { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" },
  ],
  text: [
    { provider: "groq", model: "openai/gpt-oss-120b" },
    { provider: "groq", model: "qwen/qwen3.8-27b" },
    { provider: "gemini", model: "gemini-3.5-flash-lite" },
    { provider: "gemini", model: "gemini-3.1-flash-lite" },
    { provider: "groq", model: "openai/gpt-oss-20b" },
    { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" },
  ],
};

/** How long the provider asks us to wait, in ms (Groq: retry-after header; Gemini: retryDelay in the body). */
function retryAfterMs(error: unknown): number | undefined {
  const e = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(e)) return undefined;
  const header = e.responseHeaders?.["retry-after"];
  if (header && !Number.isNaN(Number(header))) return Number(header) * 1000;
  const m = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(e.responseBody ?? "");
  return m ? Number(m[1]) * 1000 : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// provider:model:keyIndex -> benched until (ms). In-memory per server instance; good enough for free tiers.
const benched = new Map<string, number>();

function nextMidnightPacific(now = Date.now()): number {
  // Gemini free-tier daily quotas reset at midnight Pacific Time.
  const pacific = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const offset = now - pacific.getTime();
  pacific.setHours(24, 0, 0, 0);
  return pacific.getTime() + offset;
}

function modelFor(c: Candidate, key: string) {
  switch (c.provider) {
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: key })(c.model);
    case "groq":
      return createOpenAICompatible({
        name: "groq", apiKey: key, baseURL: "https://api.groq.com/openai/v1", supportsStructuredOutputs: true,
      })(c.model);
    case "openrouter":
      return createOpenAICompatible({ name: "openrouter", apiKey: key, baseURL: "https://openrouter.ai/api/v1" })(c.model);
  }
}

function statusOf(error: unknown): number | undefined {
  const e = RetryError.isInstance(error) ? error.lastError : error;
  return APICallError.isInstance(e) ? e.statusCode : undefined;
}

export type PoolResult<T> = { output: T; model: string; ms: number; attempts: string[] };

/** Run a structured-output call on the first available free model for this task. Throws only if every model fails. */
export async function runStructured<S extends z.ZodType>(opts: {
  task: Task;
  schema: S;
  system: string;
  messages: ModelMessage[];
  temperature?: number;
  exclude?: string[]; // e.g. force the 2nd grading run onto a different model than the 1st
  timeoutMs?: number;
  deadline?: number; // epoch ms: stop trying further models after this (keeps a job inside the function's time limit)
}): Promise<PoolResult<z.infer<S>>> {
  const attempts: string[] = [];
  const started = Date.now();
  for (const c of ROUTES[opts.task]) {
    const id = `${c.provider}/${c.model}`;
    if (opts.exclude?.includes(id)) continue;
    for (const [i, key] of KEYS[c.provider].entries()) {
      const slot = `${id}#${i}`;
      const until = benched.get(slot) ?? 0;
      if (until > Date.now()) {
        attempts.push(`${slot}: skipped (resting ${Math.round((until - Date.now()) / 1000)}s)`);
        continue;
      }
      if (opts.deadline && opts.deadline - Date.now() < 15_000) {
        throw new Error(`Out of time for "${opts.task}" before a free model answered: ${attempts.join(" | ")}`);
      }
      for (let tryNo = 0; tryNo < 2; tryNo++) {
        try {
          const { output } = await generateText({
            model: modelFor(c, key),
            output: Output.object({ schema: opts.schema }),
            system: opts.system,
            messages: opts.messages,
            temperature: opts.temperature ?? 0,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(Math.min(opts.timeoutMs ?? 90_000, opts.deadline ? opts.deadline - Date.now() : Infinity)),
          });
          return { output: output as z.infer<S>, model: id, ms: Date.now() - started, attempts };
        } catch (error) {
          const status = statusOf(error);
          const wait = retryAfterMs(error);
          attempts.push(`${slot}: ${status ?? (NoObjectGeneratedError.isInstance(error) ? "bad JSON" : String(error).slice(0, 80))}`);
          // A short per-minute limit: wait it out once and retry the same model (cheaper than giving up on it).
          if (status === 429 && wait !== undefined && wait <= 20_000 && tryNo === 0) {
            await sleep(wait + 250);
            continue;
          }
          if (status === 429) {
            // Long or unknown wait: Gemini's daily free quota resets at midnight Pacific; others after the stated delay.
            const daily = c.provider === "gemini" && (wait === undefined || wait > 3600_000);
            benched.set(slot, daily ? nextMidnightPacific() : Date.now() + Math.max(wait ?? 60_000, 20_000));
          } else if (status === 404 || status === 400 || status === 403) benched.set(slot, Date.now() + 6 * 3600_000);
          else benched.set(slot, Date.now() + 30_000); // timeouts, 5xx, malformed output: brief cool-down
          break;
        }
      }
    }
  }
  throw new Error(`All free models failed for "${opts.task}": ${attempts.join(" | ")}`);
}
