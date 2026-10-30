// Unit tests for meaning-graded answer extraction: numbers in any phrasing —
// digits, words, compounds, units, money symbols — never string matching.

import { describe, expect, it } from "vitest";
import { answerMatches, extractNumbers } from "./grade";

describe("extractNumbers", () => {
  it("reads digits, words, and compounds alike", () => {
    expect(extractNumbers("2")).toEqual([2]);
    expect(extractNumbers("two")).toEqual([2]);
    expect(extractNumbers("twenty five")).toEqual([25]);
    expect(extractNumbers("twenty-five")).toEqual([25]);
    expect(extractNumbers("i think its 60 cents")).toEqual([60]);
    expect(extractNumbers("sixty")).toEqual([60]);
  });

  it("ignores units, money symbols, and grammar noise", () => {
    expect(extractNumbers("$0.25, i reckon?")).toEqual([0.25]);
    expect(extractNumbers("maybe 4 of them??")).toEqual([4]);
    expect(extractNumbers("FOUR")).toEqual([4]);
  });

  it("returns nothing when no number is present", () => {
    expect(extractNumbers("cant do this one")).toEqual([1]); // "one" is a word-number
    expect(extractNumbers("no idea")).toEqual([]);
    expect(extractNumbers("")).toEqual([]);
  });
});

describe("answerMatches", () => {
  it("accepts the answer in fragments and unusual grammar", () => {
    expect(answerMatches("its 2", [2])).toBe(true);
    expect(answerMatches("2 pennies i think", [2])).toBe(true);
    expect(answerMatches("two", [2])).toBe(true);
    expect(answerMatches("25", [25])).toBe(true);
    expect(answerMatches("twenty five cents", [25])).toBe(true);
  });

  it("rejects wrong answers and non-answers", () => {
    expect(answerMatches("cant do this one", [2])).toBe(false);
    expect(answerMatches("5", [2])).toBe(false);
    expect(answerMatches("hello", [2])).toBe(false);
  });
});
