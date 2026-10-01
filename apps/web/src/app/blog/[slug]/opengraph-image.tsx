import { getPost } from "@/lib/directus/queries";
import { ogImage } from "@/lib/og";

export const alt = "Blog post by Christopher Guzman";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  // Unknown slugs get the generic image; the requested slug is never echoed.
  return post
    ? ogImage({ title: post.title, prompt: `$ cat posts/${post.slug}.md` })
    : ogImage({ title: "Blog", prompt: "$ ls posts/" });
}
