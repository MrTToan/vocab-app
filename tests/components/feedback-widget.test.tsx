import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { mockFetch, renderWithSWR, type MatchedRequest } from "./harness";
import FeedbackWidget from "@/components/FeedbackWidget";

/*
 * The floating feedback widget is pure client render/state — a green route test
 * can't see it. This drives the real component: open → validate (submit disabled
 * with no message) → fill (category + rating + message) → submit → confirmation,
 * asserting the POST body it sends (category, rating, message, page).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FeedbackWidget", () => {
  it("opens, requires a message, submits the 3 fields, and confirms", async () => {
    const postMock = vi.fn((_req: MatchedRequest) => ({ ok: true }));
    mockFetch({ "POST /api/feedback": postMock });

    renderWithSWR(<FeedbackWidget />);

    // Collapsed: only the launcher is present.
    const launcher = screen.getByRole("button", { name: "Feedback" });
    expect(screen.queryByLabelText("Message")).toBeNull();

    // Open the panel.
    fireEvent.click(launcher);
    const message = await screen.findByLabelText("Message");

    // Submit is disabled until there's a message.
    const submit = screen.getByRole("button", { name: "Send feedback" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    // Choose category = Bug and a 4-star rating.
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "bug" } });
    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));

    // Type the message → submit enables.
    fireEvent.change(message, { target: { value: "The scoring felt slow." } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);

    // Confirmation renders.
    await waitFor(() => {
      expect(screen.getByText("Thanks for your feedback!")).toBeTruthy();
    });

    // The POST carried the three fields (+ the captured page path).
    expect(postMock).toHaveBeenCalledTimes(1);
    const body = postMock.mock.calls[0]![0].body as {
      category: string;
      rating: number | null;
      message: string;
      page: string;
    };
    expect(body.category).toBe("bug");
    expect(body.rating).toBe(4);
    expect(body.message).toBe("The scoring felt slow.");
    expect(typeof body.page).toBe("string");
  });

  it("shows an error and keeps the form when the submit fails", async () => {
    mockFetch({ "POST /api/feedback": { status: 401, body: { error: "unauthorized" } } });

    renderWithSWR(<FeedbackWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("unauthorized");
    });
    // Still on the form (not the confirmation), so the user can retry.
    expect(screen.queryByText("Thanks for your feedback!")).toBeNull();
    expect(screen.getByLabelText("Message")).toBeTruthy();
  });
});
