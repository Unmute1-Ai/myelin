import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfileEditorCard, type ProfileEditorActions } from "@/components/dashboard/profile-editor-card";
import { ProfileEntryKind } from "@workspace/api-zod";
import { expectNoViolations, runAxe } from "./axe";
import { makeEntry, makeProfile } from "./fixtures";

function makeActions(): ProfileEditorActions {
  return {
    onSaveProfile: vi.fn(),
    onAddEntry: vi.fn(),
    onDeleteEntry: vi.fn(),
  };
}

describe("ProfileEditorCard", () => {
  it("renders the transparent record with kinds, subjects, and why notes", () => {
    const entries = [
      makeEntry({
        kind: ProfileEntryKind.strategy_change,
        subject: "Money math",
        detail: "Switched to pictures",
        whyChanged: "Step-by-step stalled twice",
      }),
    ];
    render(<ProfileEditorCard profile={makeProfile()} entries={entries} actions={makeActions()} saving={false} savingError={null} />);
    expect(screen.getByRole("heading", { name: "Your learning record" })).toBeInTheDocument();
    expect(screen.getByText("Switched to pictures")).toBeInTheDocument();
    expect(screen.getByText("Why: Step-by-step stalled twice")).toBeInTheDocument();
    expect(screen.getByText(/Strategy change · Money math/)).toBeInTheDocument();
  });

  it("adds a subject through the profile save path", async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    render(<ProfileEditorCard profile={makeProfile()} entries={[]} actions={actions} saving={false} savingError={null} />);
    await user.type(screen.getByLabelText("Subjects"), "Fractions");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(actions.onSaveProfile).toHaveBeenCalledWith({
      subjects: ["Money math", "Fractions"],
      pacing: "standard",
      preferredStrategy: null,
    });
  });

  it("removes a subject through the profile save path", async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    render(<ProfileEditorCard profile={makeProfile()} entries={[]} actions={actions} saving={false} savingError={null} />);
    await user.click(screen.getByRole("button", { name: "Remove subject Money math" }));
    expect(actions.onSaveProfile).toHaveBeenCalledWith({
      subjects: [],
      pacing: "standard",
      preferredStrategy: null,
    });
  });

  it("adds a learner-authored note with the chosen kind", async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    render(<ProfileEditorCard profile={makeProfile()} entries={[]} actions={actions} saving={false} savingError={null} />);
    await user.type(screen.getByLabelText("Your note"), "Charts make sense");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(actions.onAddEntry).toHaveBeenCalledWith({
      kind: ProfileEntryKind.preference,
      subject: "",
      detail: "Charts make sense",
    });
  });

  it("removes a record entry by id", async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    const entry = makeEntry({ detail: "Old note" });
    render(<ProfileEditorCard profile={makeProfile()} entries={[entry]} actions={actions} saving={false} savingError={null} />);
    await user.click(screen.getByRole("button", { name: "Remove note: Old note" }));
    expect(actions.onDeleteEntry).toHaveBeenCalledWith("entry-1");
  });

  it("disables writes while saving and surfaces the saving error", async () => {
    render(
      <ProfileEditorCard
        profile={makeProfile()}
        entries={[makeEntry()]}
        actions={makeActions()}
        saving={true}
        savingError="Saving didn't work — try again."
      />,
    );
    expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Saving didn't work — try again.");
  });

  it("passes axe", async () => {
    const { container } = render(
      <ProfileEditorCard
        profile={makeProfile()}
        entries={[makeEntry({ whyChanged: "Step-by-step stalled twice" })]}
        actions={makeActions()}
        saving={false}
        savingError={null}
      />,
    );
    expectNoViolations(await runAxe(container));
  });
});
