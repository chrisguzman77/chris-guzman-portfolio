import { connection } from "next/server";

import { serverEnv } from "@/lib/env";
import { cn } from "@/lib/utils";

const MEMO_MS = 60_000;

// Last observed result, reused for 60s so every homepage view does not hit the API.
// Not the Next data cache: that would keep serving a stale "ok" while the API is down.
let memo: { ok: boolean; at: number } | undefined;

// Never claims health it did not observe: anything other than 200 + db "ok" is "degraded".
async function checkApi(apiInternalUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiInternalUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (res.status !== 200) return false;
    const body = (await res.json()) as { db?: unknown };
    return body.db === "ok";
  } catch {
    return false;
  }
}

async function apiHealthy(): Promise<boolean> {
  const { apiInternalUrl } = serverEnv();
  if (!apiInternalUrl) return false;
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.ok;
  const ok = await checkApi(apiInternalUrl);
  memo = { ok, at: Date.now() };
  return ok;
}

function StatusLine({ dot, text }: { dot: string; text: string }) {
  return (
    <p className="flex items-center gap-1.5 font-mono text-[11.5px] text-muted-foreground">
      <span aria-hidden="true" className={cn("inline-block size-[7px] rounded-full", dot)} />
      {`${text} · self-hosted on Proxmox`}
    </p>
  );
}

// Suspense fallback while the health check runs; claims nothing either way.
export function LiveStatusFallback() {
  return <StatusLine dot="bg-muted-foreground/40" text="checking status" />;
}

export async function LiveStatus() {
  await connection();
  const ok = await apiHealthy();
  return (
    <StatusLine
      dot={ok ? "bg-live" : "bg-warn"}
      text={ok ? "all systems operational" : "degraded"}
    />
  );
}
