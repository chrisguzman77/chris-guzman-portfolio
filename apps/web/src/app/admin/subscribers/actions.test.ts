import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireAccess } from "@/lib/cf-access";
import { removeSubscriber } from "@/lib/subscribers";

import { removeSubscriberAction } from "./actions";

vi.mock("@/lib/cf-access", () => ({ requireAccess: vi.fn() }));
vi.mock("@/lib/subscribers", () => ({ removeSubscriber: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("removeSubscriberAction", () => {
  it("checks access, removes the form's id, then revalidates", async () => {
    const order: string[] = [];
    vi.mocked(requireAccess).mockImplementation(async () => void order.push("access"));
    vi.mocked(removeSubscriber).mockImplementation(async () => (order.push("remove"), true));
    vi.mocked(revalidatePath).mockImplementation(() => void order.push("revalidate"));
    const form = new FormData();
    form.set("id", "abc");
    await removeSubscriberAction(form);
    expect(removeSubscriber).toHaveBeenCalledWith("abc");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/subscribers");
    expect(order).toEqual(["access", "remove", "revalidate"]);
  });

  it("rejects and removes nothing when access is denied", async () => {
    vi.mocked(requireAccess).mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    const form = new FormData();
    form.set("id", "abc");
    await expect(removeSubscriberAction(form)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(removeSubscriber).not.toHaveBeenCalled();
  });
});
