import { ogImage } from "@/lib/og";

export const alt = "Christopher Guzman, software engineer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogImage({ title: "Christopher Guzman", prompt: "$ whoami" });
}
