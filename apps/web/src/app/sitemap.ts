import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { getPosts, getProjects } from "@/lib/directus/queries";
import { absoluteUrl } from "@/lib/seo";

const STATIC_ROUTES = [
  "/",
  "/experience",
  "/education",
  "/projects",
  "/blog",
  "/resume",
  "/contact",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const [projects, posts] = await Promise.all([getProjects(), getPosts()]);

  return [
    ...STATIC_ROUTES.map((path) => ({ url: absoluteUrl(path) })),
    ...projects.map((project) => ({ url: absoluteUrl(`/projects/${project.slug}`) })),
    ...posts.map((post) => ({
      url: absoluteUrl(`/blog/${post.slug}`),
      lastModified: post.published_at,
    })),
  ];
}
