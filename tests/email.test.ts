import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildInviteEmail, sendInviteEmail } from "@/lib/email/invite";
import { sendEmail, DEFAULT_EMAIL_FROM } from "@/lib/email/send";

/*
 * The transactional-email layer (`lib/email`). `fetch` is mocked, so nothing
 * leaves the process. Covers: the graceful no-op when RESEND_API_KEY is unset,
 * the exact Resend payload when it is set, and soft-failure (non-2xx / throw)
 * being returned rather than thrown.
 */

const INVITE = {
  to: "student@example.com",
  className: "IELTS Evening",
  teacherName: "Ms Rivera",
  acceptLink: "https://lexi.vnfriends.com/classes?invite=tok123",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buildInviteEmail", () => {
  it("puts the class, teacher, link and privacy note in subject/html/text", () => {
    const { subject, html, text } = buildInviteEmail(INVITE);
    expect(subject).toContain("Ms Rivera");
    expect(subject).toContain("IELTS Evening");
    for (const body of [html, text]) {
      expect(body).toContain("Ms Rivera");
      expect(body).toContain("IELTS Evening");
      expect(body).toContain(INVITE.acceptLink);
      expect(body.toLowerCase()).toContain("whole lexi report");
    }
  });

  it("HTML-escapes user-controlled class/teacher names", () => {
    const { html } = buildInviteEmail({
      ...INVITE,
      className: "A & B <script>",
      teacherName: "O'Brien",
    });
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("O&#39;Brien");
  });
});

describe("sendEmail — no key configured", () => {
  it("is a no-op returning `skipped` and never calls fetch", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendEmail({ to: "x@y.com", subject: "s", html: "<p>h</p>", text: "t" });

    expect(result).toEqual({ status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendInviteEmail — key configured", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "");
  });

  it("POSTs the right Resend payload and returns `sent`", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured = { url, init };
        return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
      }),
    );

    const result = await sendInviteEmail(INVITE);

    expect(result).toEqual({ status: "sent", id: "email_123" });
    expect(captured).not.toBeNull();
    const { url, init } = captured!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    const payload = JSON.parse(init.body as string);
    expect(payload.from).toBe(DEFAULT_EMAIL_FROM);
    expect(payload.to).toEqual(["student@example.com"]);
    expect(payload.subject).toContain("IELTS Evening");
    expect(payload.html).toContain(INVITE.acceptLink);
    expect(payload.text).toContain(INVITE.acceptLink);
  });

  it("honours EMAIL_FROM override", async () => {
    vi.stubEnv("EMAIL_FROM", "Lexi <hello@custom.test>");
    let body: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        body = init.body as string;
        return new Response("{}", { status: 200 });
      }),
    );

    await sendInviteEmail(INVITE);
    expect(body).not.toBeNull();
    expect(JSON.parse(body!).from).toBe("Lexi <hello@custom.test>");
  });

  it("returns `error` (not throw) on a non-2xx Resend response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("domain not verified", { status: 403 })),
    );
    const result = await sendInviteEmail(INVITE);
    expect(result.status).toBe("error");
  });

  it("returns `error` (not throw) when fetch itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await sendInviteEmail(INVITE);
    expect(result).toEqual({ status: "error", error: "network down" });
  });
});
