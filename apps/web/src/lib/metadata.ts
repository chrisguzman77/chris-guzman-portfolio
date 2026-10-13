import type { Metadata } from "next";

import { siteConfig } from "@/lib/site";

// Next merges metadata shallowly: a page that sets openGraph replaces the layout's whole object,
// so every page repeats these root defaults.
export const baseOpenGraph = {
  type: "website",
  siteName: siteConfig.name,
  locale: "en_US",
} as const;

// app/opengraph-image.tsx. A file-based image belongs to its own segment and is lost when a
// deeper page sets openGraph, so routes without their own opengraph-image file name it here.
export const rootOgImage = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Christopher Guzman, software engineer",
};

type PageMetadataInput = {
  title: string;
  description: string;
  path: string;
  // The route has its own opengraph-image file: leave images unset so the file wins.
  ownImage?: boolean;
  article?: { publishedTime?: string };
};

// Title, description and the matching Open Graph tags (Twitter inherits them from Open Graph).
export function pageMetadata({
  title,
  description,
  path,
  ownImage = false,
  article,
}: PageMetadataInput): Metadata {
  const text = { title, description: description.trim() };
  const shared = { ...text, url: path, ...(ownImage ? {} : { images: [rootOgImage] }) };
  return {
    ...text,
    openGraph: article
      ? {
          ...baseOpenGraph,
          ...shared,
          type: "article",
          ...(article.publishedTime ? { publishedTime: article.publishedTime } : {}),
        }
      : { ...baseOpenGraph, ...shared },
  };
}
