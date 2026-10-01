import { getProject } from "@/lib/directus/queries";
import { ogImage } from "@/lib/og";

export const alt = "Project write-up by Christopher Guzman";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProject(slug);
  // Unknown slugs get the generic image; the requested slug is never echoed.
  return project
    ? ogImage({ title: project.title, prompt: `$ cat projects/${project.slug}.md` })
    : ogImage({ title: "Projects", prompt: "$ ls projects/" });
}
