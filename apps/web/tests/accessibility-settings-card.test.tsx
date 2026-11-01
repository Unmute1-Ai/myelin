import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccessibilitySettingsCard } from "@/components/dashboard/accessibility-settings-card";
import { TextSize } from "@workspace/api-zod";
import { expectNoViolations, runAxe } from "./axe";
import { makePrefs } from "./fixtures";

describe("AccessibilitySettingsCard", () => {
  it("renders every toggle with its stored state as a switch", () => {
    render(
      <AccessibilitySettingsCard
        prefs={makePrefs()}
        saving={false}
        savingError={null}
        onToggle={vi.fn()}
        onTextSize={vi.fn()}
        onBreakInterval={vi.fn()}
      />,
    );
    const readAloud = screen.getByRole("switch", { name: /Read aloud/ });
    expect(readAloud).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: /Captions/ })).toHaveAttribute("aria-checked", "true");
  });

  it("toggles a preference and reports the new value", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <AccessibilitySettingsCard
        prefs={makePrefs()}
        saving={false}
        savingError={null}
        onToggle={onToggle}
        onTextSize={vi.fn()}
        onBreakInterval={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("switch", { name: /Read aloud/ }));
    expect(onToggle).toHaveBeenCalledWith("ttsEnabled", true);
  });

  it("selects a text size through the radio group", async () => {
    const user = userEvent.setup();
    const onTextSize = vi.fn();
    render(
      <AccessibilitySettingsCard
        prefs={makePrefs()}
        saving={false}
        savingError={null}
        onToggle={vi.fn()}
        onTextSize={onTextSize}
        onBreakInterval={vi.fn()}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Text size" });
    expect(group).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Extra large" }));
    expect(onTextSize).toHaveBeenCalledWith(TextSize.xlarge);
  });

  it("shows the break interval only when break reminders are on", () => {
    const { rerender } = render(
      <AccessibilitySettingsCard
        prefs={makePrefs({ allowBreaks: true, breakIntervalMinutes: 30 })}
        saving={false}
        savingError={null}
        onToggle={vi.fn()}
        onTextSize={vi.fn()}
        onBreakInterval={vi.fn()}
      />,
    );
    expect(screen.getByRole("slider")).toHaveValue("30");

    rerender(
      <AccessibilitySettingsCard
        prefs={makePrefs({ allowBreaks: false })}
        saving={false}
        savingError={null}
        onToggle={vi.fn()}
        onTextSize={vi.fn()}
        onBreakInterval={vi.fn()}
      />,
    );
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("surfaces the saving error as an alert", () => {
    render(
      <AccessibilitySettingsCard
        prefs={makePrefs()}
        saving={false}
        savingError="Saving didn't work — try again."
        onToggle={vi.fn()}
        onTextSize={vi.fn()}
        onBreakInterval={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Saving didn't work — try again.");
  });

  it("passes axe", async () => {
    const { container } = render(
      <AccessibilitySettingsCard
        prefs={makePrefs()}
        saving={false}
        savingError={null}
        onToggle={vi.fn()}
        onTextSize={vi.fn()}
        onBreakInterval={vi.fn()}
      />,
    );
    expectNoViolations(await runAxe(container));
  });
});
