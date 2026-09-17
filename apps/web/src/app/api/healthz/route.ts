import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
  });
}
