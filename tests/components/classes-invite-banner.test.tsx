import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import InviteBanner from "@/components/classes/InviteBanner";
import type { PendingInvite } from "@/lib/classes/types";

/*
 * The invite banner is a launch-gate surface: accepting an email invite must go
 * through the SAME whole-report consent screen as the code-join, never a silent
 * auto-join. These render-layer tests assert exactly that flow.
 */

const invite: PendingInvite = {
  id: "inv-1",
  token: "tok-abc",
  class: { id: "c1", name: "IELTS Evening", emoji: "📗" },
  teacher: { name: "Ms. Vo" },
};

describe("InviteBanner", () => {
  it("names the teacher + class and routes Accept through the consent screen", async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onDecline = vi.fn().mockResolvedValue(undefined);
    render(<InviteBanner invites={[invite]} onAccept={onAccept} onDecline={onDecline} />);

    // The banner names who invited the student and to what.
    expect(screen.getByText(/Ms\. Vo invited you to/)).toBeTruthy();
    expect(screen.getByText(/IELTS Evening/)).toBeTruthy();
    expect(screen.getByText(/see your full Lexi report/i)).toBeTruthy();

    // Accept does NOT immediately join — it opens the consent screen first.
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/whole Lexi report/i)).toBeTruthy();
    expect(onAccept).not.toHaveBeenCalled();

    // The affirmative consent button IS what fires the join.
    fireEvent.click(screen.getByRole("button", { name: "Join & share" }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(onAccept).toHaveBeenCalledWith(invite);
  });

  it("Decline fires the decline callback without opening consent", async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onDecline = vi.fn().mockResolvedValue(undefined);
    render(<InviteBanner invites={[invite]} onAccept={onAccept} onDecline={onDecline} />);

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(onDecline).toHaveBeenCalledWith(invite));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("an accept-link token opens the matching invite's consent on mount", () => {
    render(
      <InviteBanner
        invites={[invite]}
        onAccept={vi.fn().mockResolvedValue(undefined)}
        onDecline={vi.fn().mockResolvedValue(undefined)}
        autoOpenToken="tok-abc"
      />,
    );
    // Landed straight on the consent moment for that invite.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText(/IELTS Evening/)).toBeTruthy();
    expect(within(dialog).getByText(/whole Lexi report/i)).toBeTruthy();
  });

  it("renders nothing when there are no invites", () => {
    const { container } = render(
      <InviteBanner invites={[]} onAccept={vi.fn()} onDecline={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
