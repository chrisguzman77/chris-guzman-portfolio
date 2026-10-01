import { connection } from "next/server";

import { serverEnv } from "@/lib/env";
import { cn } from "@/lib/utils";

// Never claims health it did not observe: anything other than 200 + db "ok" is "degraded".
async function apiHealthy(): Promise<boolean> {
  const { apiInternalUrl } = serverEnv();
  if (!apiInternalUrl) return false;
  try {
    const res = await fetch(`${apiInternalUrl}/health`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(2000),
    });
    if (res.status !== 200) return false;
    const body = (await res.json()) as { db?: unknown };
    return body.db === "ok";
  } catch {
    return false;
  }
}

export async function LiveStatus() {
  await connection();
  const ok = await apiHealthy();
  return (
    <p className="flex items-center gap-1.5 font-mono text-[11.5px] text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn("inline-block size-[7px] rounded-full", ok ? "bg-live" : "bg-warn")}
      />
      {`${ok ? "all systems operational" : "degraded"} · self-hosted on Proxmox`}
    </p>
  );
}
