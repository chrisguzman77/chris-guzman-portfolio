import type { Metadata } from "next";

import { BackLink } from "@/components/content/back-link";
import { EmptyState } from "@/components/content/empty-state";
import { PageHeader } from "@/components/content/page-header";
import { PostListItem } from "@/components/content/post-list-item";
import { SubscribeForm } from "@/components/newsletter/subscribe-form";
import { getPosts } from "@/lib/directus/queries";
import { serverEnv } from "@/lib/env";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Blog",
    description: "Writing by Christopher Guzman on software, security, and machine learning.",
    path: "/blog",
  }),
  alternates: { types: { "application/rss+xml": "/blog/rss.xml" } },
};

export default async function BlogPage() {
  const posts = await getPosts();
  const { turnstileSiteKey, publicApiUrl } = serverEnv();

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <BackLink href="/" label="home" />
      <div className="mt-5">
        <PageHeader prompt="$ ls posts/" title="Blog" />
      </div>
      {turnstileSiteKey ? (
        <div className="mt-4">
          <SubscribeForm apiUrl={publicApiUrl} siteKey={turnstileSiteKey} />
        </div>
      ) : null}
      <h2 className="sr-only">All posts</h2>
      <div className="mt-4">
        {posts.length > 0 ? (
          <ol className="space-y-3">
            {posts.map((post) => (
              <li key={post.id}>
                <PostListItem post={post} />
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState>$ ls posts/ → nothing yet. First post coming soon.</EmptyState>
        )}
      </div>
    </div>
  );
}
