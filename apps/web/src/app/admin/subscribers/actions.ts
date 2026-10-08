"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/cf-access";
import { removeSubscriber } from "@/lib/subscribers";

// Server actions are public POST endpoints: the Access check runs here too, not only on the page.
export async function removeSubscriberAction(formData: FormData): Promise<void> {
  await requireAccess();
  const id = formData.get("id");
  if (typeof id === "string") await removeSubscriber(id);
  revalidatePath("/admin/subscribers");
}
