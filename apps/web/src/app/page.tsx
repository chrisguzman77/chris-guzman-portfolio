import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";

export default function HomePage() {
  return (
    <section className="mx-auto grid max-w-5xl items-center gap-12 px-6 py-20 md:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">Portfolio</p>
        <h1 className="font-display text-5xl leading-tight tracking-tight md:text-6xl">
          {siteConfig.name}
        </h1>
        <p className="max-w-prose text-lg text-muted-foreground">{siteConfig.headline}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <a href={siteConfig.links.github} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={siteConfig.links.linkedin} target="_blank" rel="noopener noreferrer">
              LinkedIn
            </a>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/api/healthz">Status</Link>
          </Button>
        </div>
      </div>
      <Image
        src="/images/chris.jpg"
        alt="Portrait of Christopher Guzman"
        width={788}
        height={985}
        preload
        sizes="(min-width: 768px) 320px, 80vw"
        className="mx-auto w-64 rounded-2xl border border-border/60 shadow-sm md:w-80"
      />
    </section>
  );
}
