import type { ReactNode } from "react";

import { GREEN_AT, dayLabel, formatAgo, formatPercent, getStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

const DAYS = 30;
const NONE = "—";
const STACK = "Proxmox · Docker · Cloudflare Tunnel";
const MUTED_BAR = "bg-muted-foreground/30";

type Bar = { key: string; label: string | null; className: string };

function show<T>(value: T | null | undefined, format: (value: T) => string): string {
  return value === null || value === undefined ? NONE : format(value);
}

function barClass(uptime: number | null): string {
  if (uptime === null) return MUTED_BAR;
  return uptime >= GREEN_AT ? "bg-live" : "bg-warn";
}

function Frame({
  dot,
  headline,
  children,
}: {
  dot: string;
  headline: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label="Site status"
      className="w-full rounded-[10px] border border-border bg-card px-4 py-3.5 font-mono text-[11.5px] text-muted-foreground md:max-w-[380px]"
    >
      <p className="mb-2 flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn("inline-block size-[7px] shrink-0 rounded-full", dot)}
        />
        {`${headline} · self-hosted on Proxmox`}
      </p>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt>{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Bars({ bars }: { bars: Bar[] }) {
  return (
    <>
      <div className="mt-1 mb-1.5 flex gap-0.5">
        {bars.map((bar) =>
          bar.label ? (
            <span
              key={bar.key}
              role="img"
              title={bar.label}
              aria-label={bar.label}
              className={cn("h-[18px] flex-1 rounded-[2px] opacity-85", bar.className)}
            />
          ) : (
            <span
              key={bar.key}
              aria-hidden="true"
              className={cn("h-[18px] flex-1 rounded-[2px]", bar.className)}
            />
          ),
        )}
      </div>
      <div className="mb-1.5 flex justify-between text-[10px]">
        <span>30 days ago</span>
        <span>today</span>
      </div>
    </>
  );
}

function Pending() {
  return (
    <span aria-hidden="true" className="inline-block h-3 w-12 animate-pulse rounded bg-muted" />
  );
}

// Suspense fallback while /v1/status loads; claims nothing about health.
export function StatusCardSkeleton() {
  const bars = Array.from({ length: DAYS }, (_, i) => ({
    key: String(i),
    label: null,
    className: `animate-pulse ${MUTED_BAR}`,
  }));
  return (
    <Frame dot="bg-muted-foreground/40" headline="checking status">
      <dl>
        <Row label="uptime (30d)" value={<Pending />} />
      </dl>
      <Bars bars={bars} />
      <dl>
        <Row label="api response (p95)" value={<Pending />} />
        <Row label="requests today" value={<Pending />} />
        <Row label="last backup" value={<Pending />} />
        <Row label="stack" value={STACK} />
      </dl>
    </Frame>
  );
}

// Never claims health it did not observe: an unreachable API renders "degraded" with no numbers.
export async function StatusCard() {
  const status = await getStatus();
  const operational = status?.status === "operational";
  const bars: Bar[] = status
    ? status.daily.map((day) => ({
        key: day.date,
        label: dayLabel(day),
        className: barClass(day.uptime),
      }))
    : Array.from({ length: DAYS }, (_, i) => ({
        key: String(i),
        label: "no data",
        className: MUTED_BAR,
      }));

  return (
    <Frame
      dot={operational ? "bg-live" : "bg-warn"}
      headline={operational ? "all systems operational" : "degraded"}
    >
      <dl>
        <Row label="uptime (30d)" value={show(status?.uptime_30d, formatPercent)} />
      </dl>
      <Bars bars={bars} />
      <dl>
        <Row label="api response (p95)" value={show(status?.p95_ms, (ms) => `${ms} ms`)} />
        <Row
          label="requests today"
          value={show(status?.requests_today, (n) => n.toLocaleString("en-US"))}
        />
        <Row
          label="last backup"
          value={show(status?.last_backup_at, (iso) => `${formatAgo(iso)} · encrypted · R2`)}
        />
        <Row label="stack" value={STACK} />
      </dl>
    </Frame>
  );
}
