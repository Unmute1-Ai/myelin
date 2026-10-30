// Meaning-graded check grading for the scripted provider: extract the numbers
// a learner typed (digits or words, units and money symbols ignored) and
// compare them to the accepted answers. Fragments, unusual grammar, and
// non-native phrasing never block meaning; answers are never string-matched.
//
// Known limits (documented, accepted for the scripted default): only numeric
// answers are gradable, and homographs like "one" in "this one" count as
// numbers — the demo lesson has no accepted answer of 1, and real meaning
// grading belongs to the model-backed providers.

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

const TENS_WORDS = new Set(["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]);

/** Extract every number the learner's input carries — digits or words. */
export function extractNumbers(input: string): number[] {
  const text = input
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/(\w)-(\w)/g, "$1 $2"); // "twenty-five" → "twenty five"

  const numbers: number[] = [];
  for (const match of text.matchAll(/\d+(?:\.\d+)?/g)) {
    numbers.push(Number.parseFloat(match[0]));
  }

  const words = text.match(/[a-z]+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const value = WORD_NUMBERS[word];
    if (value === undefined) continue;
    // Compound: "twenty five" (tens word followed by a unit word).
    if (TENS_WORDS.has(word)) {
      const next = words[i + 1];
      const nextValue = next === undefined ? undefined : WORD_NUMBERS[next];
      if (nextValue !== undefined && nextValue > 0 && nextValue < 10) {
        numbers.push(value + nextValue);
        i++; // consume the unit word
        continue;
      }
    }
    numbers.push(value);
  }

  return numbers;
}

/** True when the input carries one of the accepted answers as its meaning. */
export function answerMatches(input: string, acceptedNumbers: readonly number[]): boolean {
  const numbers = extractNumbers(input);
  return numbers.some((n) => acceptedNumbers.some((a) => Math.abs(n - a) < 1e-9));
}
