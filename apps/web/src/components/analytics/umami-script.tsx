import { connection } from "next/server";

import { serverEnv } from "@/lib/env";

// Request-time read: the image is built once with no env, and the website ID only exists
// after Umami's first login. Without it the site loads no tracking code at all.
export async function UmamiScript({ nonce }: { nonce?: string }) {
  await connection();
  const { umamiWebsiteId } = serverEnv();
  if (!umamiWebsiteId) return null;
  return (
    <script
      defer
      nonce={nonce}
      src="/stats/script.js"
      data-website-id={umamiWebsiteId}
      data-host-url="/stats"
    />
  );
}
