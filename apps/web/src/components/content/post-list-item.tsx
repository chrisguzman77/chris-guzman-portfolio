import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { PostSummary } from "@/lib/directus/schemas";
import { formatPostDate } from "@/lib/format";

export function PostListItem({ post }: { post: PostSummary }) {
  return (
    <article className="card-glow rounded-[10px] border border-border bg-card p-4">
      {/* The button sits top right but after the title in the DOM, so it's read after it. */}
      <div data-post-top="" className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11.5px] text-muted-foreground">
            <time dateTime={post.published_at}>{formatPostDate(post.published_at)}</time>
          </p>
          <h3 className="mt-1 text-[17px] font-semibold">{post.title}</h3>
        </div>
        <Button asChild variant="outline" className="h-9 shrink-0 px-3.5 text-[13px]">
          <Link href={`/blog/${post.slug}`} aria-label={`Read post: ${post.title}`}>
            Read post
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">{post.excerpt}</p>
      {post.tags.length > 0 ? (
        <ul aria-label="Tags" className="mt-2.5 flex flex-wrap gap-1">
          {post.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-md border border-input px-1.5 font-mono text-[10.5px] text-muted-foreground"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
