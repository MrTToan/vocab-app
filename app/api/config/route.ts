import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { hasAnyLLM, mode, chainStatus } from "@/lib/providers";

export async function GET() {
  const { active, chain } = chainStatus();
  return NextResponse.json({
    backend: getStore().backend(), // "sheet" | "sqlite"
    hasLLM: hasAnyLLM(),
    mode: mode(), // "default" | "custom" | "chain"
    active, // index of the provider currently in use
    chain, // ordered [{ provider, model }] (no keys)
  });
}
