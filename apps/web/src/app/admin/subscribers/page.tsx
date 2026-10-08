import type { Metadata } from "next";

import { PageHeader } from "@/components/content/page-header";
import { requireAccess } from "@/lib/cf-access";
import { listSubscribers } from "@/lib/subscribers";

import { removeSubscriberAction } from "./actions";

export const metadata: Metadata = {
  title: "Subscribers",
  robots: { index: false, follow: false },
};

const cell = "px-4 py-2";
const day = (iso: string) => iso.slice(0, 10);

export default async function SubscribersPage() {
  await requireAccess();
  const list = await listSubscribers();
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <PageHeader prompt="$ newsletter ls" title="Subscribers" />
      {list === null ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Couldn&apos;t load subscribers. Check that the API is up and INTERNAL_API_SECRET is set.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-foreground">
            {list.totals.confirmed} confirmed · {list.totals.pending} pending
          </p>
          {list.subscribers.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No subscribers yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-[10px] border border-border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className={`${cell} font-medium`}>
                      Email
                    </th>
                    <th scope="col" className={`${cell} font-medium`}>
                      Status
                    </th>
                    <th scope="col" className={`${cell} font-medium`}>
                      Signed up
                    </th>
                    <th scope="col" className={`${cell} font-medium`}>
                      Confirmed
                    </th>
                    <th scope="col" className={cell}>
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.subscribers.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className={`${cell} break-all font-mono text-xs`}>{s.email}</td>
                      <td className={cell}>{s.status}</td>
                      <td className={cell}>{day(s.created_at)}</td>
                      <td className={cell}>{s.confirmed_at ? day(s.confirmed_at) : "–"}</td>
                      <td className={`${cell} text-right`}>
                        <form action={removeSubscriberAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <button
                            type="submit"
                            aria-label={`Remove ${s.email}`}
                            className="rounded-md border border-input px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
                          >
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
