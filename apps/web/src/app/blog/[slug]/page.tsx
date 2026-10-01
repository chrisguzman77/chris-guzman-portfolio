import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/content/page-header";
import { Prose } from "@/components/content/prose";
import { getPost } from "@/lib/directus/queries";
import { formatPostDate } from "@/lib/format";
import { renderMarkdown, type Heading } from "@/lib/markdown";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ slug: string }> };

const outlineButton =
  "inline-flex items-center gap-2 rounded-md border border-input px-3.5 py-2 text-[13px] text-foreground transition-colors hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};
  return { title: post.title, description: post.excerpt };
}

function TableOfContents({ headings }: { headings: Heading[] }) {
  let section = 0;
  return (
    <aside className="hidden self-start lg:sticky lg:top-24 lg:block">
      <nav
        aria-label="On this page"
        className="border-l border-border pl-3.5 font-mono text-xs leading-[1.9] text-muted-foreground"
      >
        <p className="mb-1.5 text-[11px] uppercase tracking-[0.06em]">on this page</p>
        <ul>
          {headings.map((heading) => {
            const label = heading.depth === 2 ? `${++section}. ${heading.text}` : heading.text;
            return (
              <li key={heading.id} className={heading.depth === 3 ? "pl-3" : undefined}>
                <a
                  href={`#${heading.id}`}
                  className="rounded transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
                >
                  {label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const { html, headings } = await renderMarkdown(post.body);
  const hasToc = headings.length > 0;

  return (
    <article className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader prompt={`$ cat posts/${post.slug}.md`} title={post.title} />
      <div className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted-foreground">
        <time dateTime={post.published_at}>{formatPostDate(post.published_at)}</time>
        {post.tags.length > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <ul className="flex flex-wrap gap-1" aria-label="Tags">
              {post.tags.map((tag) => (
                <li key={tag} className="rounded-md border border-input px-1.5 py-px text-[10.5px]">
                  {tag}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div className={cn("mt-8 grid gap-8", hasToc && "lg:grid-cols-[1fr_190px]")}>
        <div className="min-w-0">
          <Prose html={html} />
        </div>
        {hasToc ? <TableOfContents headings={headings} /> : null}
      </div>

      <div className="mt-10 border-t border-border pt-4">
        <Link href="/blog" className={outlineButton}>
          ← all posts
        </Link>
      </div>
    </article>
  );
}
