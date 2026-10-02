// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactForm } from "./contact-form";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));

const fetchMock = vi.fn();
const turnstile = {
  render: vi.fn(),
  reset: vi.fn(),
  remove: vi.fn(),
};

function renderForm() {
  return render(
    <ContactForm
      apiUrl="https://api.example.com"
      siteKey="site-key"
      fallbackEmail="chris@example.com"
    />,
  );
}

function fill(values: Partial<Record<"Name" | "Email" | "Message", string>>) {
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

const valid = { Name: "Ada", Email: "ada@example.com", Message: "Hello there, Chris!" };

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  turnstile.render.mockImplementation((_el, options: { callback: (t: string) => void }) => {
    options.callback("tok-1");
    return "widget-1";
  });
  window.turnstile = turnstile;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  turnstile.render.mockReset();
  turnstile.reset.mockReset();
  delete window.turnstile;
});

describe("ContactForm", () => {
  it("renders Turnstile with the site key, theme and interaction-only appearance", async () => {
    await act(async () => {
      renderForm();
    });
    expect(turnstile.render).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        sitekey: "site-key",
        theme: "dark",
        appearance: "interaction-only",
      }),
    );
  });

  it("shows field errors, marks fields invalid and focuses the first one without calling the API", async () => {
    await act(async () => {
      renderForm();
    });
    fill({ Email: "nope" });
    await submit();
    expect(screen.getByText("Enter your name.")).toBeTruthy();
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(screen.getByText("Message must be at least 10 characters.")).toBeTruthy();
    const name = screen.getByLabelText("Name");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toBe("contact-name-error");
    expect(document.activeElement).toBe(name);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the message with the Turnstile token and replaces the form on success", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/contact");
    expect(JSON.parse(init.body)).toMatchObject({ turnstile_token: "tok-1", website: "" });
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Message sent. I'll reply to the email you gave.");
    expect(document.activeElement).toBe(status);
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("disables the button and shows Sending… while waiting", async () => {
    let resolve: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    const button = screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await act(async () => resolve(new Response(null, { status: 202 })));
  });

  it.each([
    [
      429,
      { error: { code: "rate_limited", message: "x" } },
      "Too many messages. Try again later, or email me directly.",
    ],
    [400, { error: { code: "turnstile_failed", message: "x" } }, "Spam check failed. Try again."],
  ])("shows the banner for %i and resets Turnstile", async (status, body, text) => {
    fetchMock.mockResolvedValue(Response.json(body, { status }));
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    expect(screen.getByRole("alert").textContent).toBe(text);
    expect(turnstile.reset).toHaveBeenCalledWith("widget-1");
  });

  it("shows API field errors under the fields", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "invalid_request", message: "x", fields: { email: "Email rejected." } } },
        { status: 400 },
      ),
    );
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    expect(screen.getByText("Email rejected.")).toBeTruthy();
  });

  it("falls back to the email address and keeps the input when the API is down", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Couldn't send. Email me at chris@example.com instead.");
    expect(alert.querySelector('a[href="mailto:chris@example.com"]')).toBeTruthy();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(valid.Message);
  });

  it("asks the visitor to wait when Turnstile has no token yet", async () => {
    turnstile.render.mockImplementation(() => "widget-1");
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    expect(screen.getByRole("alert").textContent).toBe(
      "Spam check is still running. Try again in a moment.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the email address when the Turnstile script fails to load", async () => {
    delete window.turnstile;
    await act(async () => {
      renderForm();
    });
    const script = document.getElementById("cf-turnstile-script");
    expect(script).toBeTruthy();
    await act(async () => {
      script?.dispatchEvent(new Event("error"));
    });
    // A failed script is removed so a later mount can try again.
    expect(document.getElementById("cf-turnstile-script")).toBeNull();
    fill(valid);
    await submit();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Couldn't send. Email me at chris@example.com instead.");
    expect(alert.querySelector('a[href="mailto:chris@example.com"]')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the email address when the Turnstile widget errors", async () => {
    turnstile.render.mockImplementation((_el, options: { "error-callback": () => void }) => {
      options["error-callback"]();
      return "widget-1";
    });
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    expect(screen.getByRole("alert").textContent).toBe(
      "Couldn't send. Email me at chris@example.com instead.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides the honeypot from people, keyboards and autofill but still sends it as website", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await act(async () => {
      renderForm();
    });
    expect(document.querySelector('input[name="website"]')).toBeNull();
    const honeypot = document.querySelector('input[name="contact_hp"]') as HTMLInputElement;
    expect(honeypot.id).toBe("contact-hp");
    expect(honeypot.autocomplete).toBe("off");
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.closest('[aria-hidden="true"]')).toBeTruthy();
    fireEvent.change(honeypot, { target: { value: "spam.example" } });
    fill(valid);
    await submit();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ website: "spam.example" });
  });
});
