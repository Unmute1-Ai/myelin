import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCE_FIELDS,
  mergePrefs,
  prefsToDocumentAttributes,
  withSystemMotion,
} from "@/lib/accessibility/prefs";

describe("withSystemMotion", () => {
  it("reduces motion when either the learner or the OS asks for calm", () => {
    expect(withSystemMotion({ ...DEFAULT_PREFERENCE_FIELDS }, true).reducedMotion).toBe(true);
    expect(
      withSystemMotion({ ...DEFAULT_PREFERENCE_FIELDS, reducedMotion: true }, false).reducedMotion,
    ).toBe(true);
    expect(withSystemMotion({ ...DEFAULT_PREFERENCE_FIELDS }, false).reducedMotion).toBe(false);
  });

  it("changes only the motion field", () => {
    const result = withSystemMotion({ ...DEFAULT_PREFERENCE_FIELDS, textSize: "large" }, true);
    expect(result.textSize).toBe("large");
    expect(Object.keys(result).sort()).toEqual(
      Object.keys({ ...DEFAULT_PREFERENCE_FIELDS }).sort(),
    );
  });
});

describe("prefsToDocumentAttributes", () => {
  it("maps defaults to the attributes the app-wide CSS keys on", () => {
    expect(prefsToDocumentAttributes(DEFAULT_PREFERENCE_FIELDS)).toEqual({
      "data-text-size": "medium",
      "data-contrast": "normal",
      "data-motion": "full",
      "data-aac-input": "off",
      "data-breaks": "on",
    });
  });

  it("flips every attribute when every preference is turned on", () => {
    const all = {
      ...DEFAULT_PREFERENCE_FIELDS,
      highContrast: true,
      textSize: "xlarge" as const,
      reducedMotion: true,
      aacInputEnabled: true,
      allowBreaks: false,
    };
    expect(prefsToDocumentAttributes(all)).toEqual({
      "data-text-size": "xlarge",
      "data-contrast": "high",
      "data-motion": "reduced",
      "data-aac-input": "on",
      "data-breaks": "off",
    });
  });
});

describe("mergePrefs", () => {
  it("applies a partial patch without dropping untouched fields", () => {
    const merged = mergePrefs(DEFAULT_PREFERENCE_FIELDS, { captionsEnabled: false });
    expect(merged.captionsEnabled).toBe(false);
    expect(merged.textSize).toBe("medium");
    expect(merged.breakIntervalMinutes).toBe(20);
  });
});
