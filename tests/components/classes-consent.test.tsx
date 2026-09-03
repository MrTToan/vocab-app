import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConsentDialog from "@/components/classes/ConsentDialog";
import TrustCard from "@/components/classes/TrustCard";

/*
 * The privacy launch gate is UI copy, so it is tested at the render layer:
 *  - the consent screen must state the WHOLE-report warning before any join;
 *  - the student trust card must name exactly WHO can see them.
 */

describe("ConsentDialog", () => {
  it("names the class + teacher and shows the whole-report warning", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConsentDialog
        name="IELTS Evening"
        emoji="📗"
        teacherName="Ms. Vo"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    // Class + teacher are named.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/IELTS Evening/)).toBeTruthy();
    expect(screen.getByText(/Ms\. Vo/)).toBeTruthy();

    // The unmissable whole-report warning, stated plainly.
    expect(screen.getByText(/whole Lexi report/i)).toBeTruthy();
    expect(screen.getByText(/updated live/i)).toBeTruthy();
    expect(screen.getByText(/leave any time/i)).toBeTruthy();

    // The affirmative button IS the consent.
    fireEvent.click(screen.getByRole("button", { name: "Join & share" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables the buttons while a join is in flight", () => {
    render(
      <ConsentDialog name="Prep" teacherName="Mr. Lee" busy onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect((screen.getByRole("button", { name: "Joining…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("TrustCard", () => {
  it("names the single teacher who can see the student's full report", () => {
    render(<TrustCard teacherNames={["Ms. Vo"]} />);
    expect(screen.getByText(/Ms\. Vo can see your full Lexi report/)).toBeTruthy();
    expect(screen.getByText(/Leaving stops this immediately/i)).toBeTruthy();
  });

  it("lists every teacher when a class has more than one", () => {
    render(<TrustCard teacherNames={["Ms. Vo", "Mr. Lee"]} />);
    expect(screen.getByText(/Ms\. Vo and Mr\. Lee can see your full Lexi report/)).toBeTruthy();
  });

  it("offers a Leave button that fires the callback", () => {
    const onLeave = vi.fn();
    render(<TrustCard teacherNames={["Ms. Vo"]} onLeave={onLeave} />);
    fireEvent.click(screen.getByRole("button", { name: "Leave class" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
