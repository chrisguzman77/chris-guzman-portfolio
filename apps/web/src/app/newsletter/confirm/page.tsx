import type { Metadata } from "next";

import { PageHeader } from "@/components/content/page-header";
import { NewsletterAction } from "@/components/newsletter/newsletter-action";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: "Confirm subscription",
  robots: { index: false, follow: false },
};

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const { publicApiUrl } = serverEnv();
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <PageHeader prompt="$ newsletter confirm" title="Confirm subscription" />
      <NewsletterAction
        action="confirm"
        apiUrl={publicApiUrl}
        token={typeof token === "string" ? token : ""}
      />
    </div>
  );
}
