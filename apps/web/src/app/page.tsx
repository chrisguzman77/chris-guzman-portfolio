import { siteConfig } from "@/lib/site";

export default function HomePage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-20">
      <p className="font-mono text-xs text-accent-brand">$ whoami</p>
      <h1 className="mt-2.5 text-5xl font-semibold tracking-tight">{siteConfig.name}</h1>
    </section>
  );
}
