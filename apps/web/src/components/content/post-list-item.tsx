import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { Post } from "@/lib/directus/schemas";
import { formatPostDate } from "@/lib/format";

export function PostListItem({ post }: { post: Post }) {
  return (
    <article className="py-4">
      <p className="font-mono text-[11.5px] text-muted-foreground">
        <time dateTime={post.published_at}>{formatPostDate(post.published_at)}</time>
      </p>
      <h3 className="mt-1 mb-1.5 text-[17px] font-semibold">{post.title}</h3>
      <p className="mb-2.5 text-sm text-muted-foreground">{post.excerpt}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {post.tags.length > 0 ? (
          <ul aria-label="Tags" className="flex flex-wrap gap-1">
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
        <Button asChild variant="outline" className="ml-auto h-9 px-3.5 text-[13px]">
          <Link href={`/blog/${post.slug}`} aria-label={`Read post: ${post.title}`}>
            Read post
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </article>
  );
}
