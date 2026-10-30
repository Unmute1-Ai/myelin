// The MVP demo lesson: everyday money math (brief-recommended candidate;
// swapping the subject costs a lesson-module swap, nothing else — spec
// assumption). Eight micro-steps, each with a meaning-graded check.

import type { DemoLesson } from "./types";

export const DEMO_LESSON: DemoLesson = {
  id: "everyday-money-math",
  title: "Everyday money math: coins, dollars, and change",
  steps: [
    {
      id: "pennies",
      concept: "what a penny is worth",
      spoken: "A penny is one cent. Let's start there.",
      teaching:
        "A penny is the smallest coin — it is worth 1 cent.\n\nWritten down: 1¢, which is the same as $0.01.\n\nIf you hold 2 pennies, you have 2 cents.",
      check: {
        question: "How many pennies make 2 cents?",
        acceptedNumbers: [2],
        onCorrect: "That's it — 2 pennies, 2 cents.",
        stuckReply:
          "No rush. One penny is 1 cent, so count them one at a time: penny, penny. How many is that?",
      },
    },
    {
      id: "nickels",
      concept: "what a nickel is worth",
      spoken: "A nickel is worth 5 cents — five pennies in one coin.",
      teaching:
        "A nickel is worth 5 cents.\n\nThat means one nickel equals 5 pennies lined up: 1, 2, 3, 4, 5.",
      check: {
        question: "How many pennies equal one nickel?",
        acceptedNumbers: [5],
        onCorrect: "Right — 5 pennies in every nickel.",
        stuckReply:
          "You're doing fine. A nickel is 5 cents and a penny is 1 cent — so count by ones up to 5. How many pennies is that?",
      },
    },
    {
      id: "dimes",
      concept: "how dimes and nickels trade",
      spoken: "A dime is worth 10 cents. Two nickels make a dime.",
      teaching:
        "A dime is worth 10 cents.\n\nNickels are worth 5 each, so count by fives: 5, 10.\n\nTwo nickels make 10 cents — one dime.",
      check: {
        question: "How many nickels make one dime?",
        acceptedNumbers: [2],
        onCorrect: "Yes — two nickels, one dime.",
        stuckReply:
          "Take your time. Count nickels by fives: 5, then 10. A dime is 10 cents — how many fives is that?",
      },
    },
    {
      id: "quarters",
      concept: "what a quarter is worth",
      spoken: "A quarter is worth 25 cents.",
      teaching:
        "A quarter is worth 25 cents.\n\nFour quarters would be 25 + 25 + 25 + 25 — that's coming up.\n\nFor now: one quarter = 25¢.",
      check: {
        question: "How many cents is one quarter worth?",
        acceptedNumbers: [25],
        onCorrect: "Exactly — a quarter is 25 cents.",
        stuckReply:
          "No stress — this one's just remembering the name. A quarter is worth 25 cents. How many cents is that?",
      },
    },
    {
      id: "quarters-to-dollar",
      concept: "how many quarters make a dollar",
      spoken: "A dollar is 100 cents. Four quarters make a dollar.",
      teaching:
        "A dollar is 100 cents.\n\nQuarters are 25 cents each, so count by 25s: 25, 50, 75, 100.\n\nThat's 4 quarters — one dollar.",
      check: {
        question: "How many quarters make one dollar?",
        acceptedNumbers: [4],
        onCorrect: "Yes — four quarters make a dollar.",
        stuckReply:
          "You've got this. Count quarters by 25s: 25, 50, 75, 100. How many counts is that?",
      },
    },
    {
      id: "mixed-coins",
      concept: "adding mixed coins",
      spoken: "Now let's add coins together. Two quarters and a dime is 60 cents.",
      teaching:
        "You have 2 quarters and 1 dime.\n\nQuarters first: 25 + 25 = 50 cents.\n\nThen the dime: 50 + 10 = 60 cents.",
      check: {
        question: "How many cents is 2 quarters and 1 dime together?",
        acceptedNumbers: [60],
        onCorrect: "That's it — 60 cents, counted piece by piece.",
        stuckReply:
          "Nothing wrong with going slow. Quarters first: 25 + 25 = 50. Then add the dime: 50 + 10. What's the total?",
      },
    },
    {
      id: "making-change",
      concept: "making change",
      spoken:
        "Change is what comes back when you pay more than the cost. Pay 5 dollars for a 3 dollar list, 2 dollars come back.",
      teaching:
        "Your list costs 3 dollars. You pay with a 5 dollar bill.\n\nChange = what you paid − what it cost: 5 − 3 = 2.\n\nSo 2 dollars come back to you.",
      check: {
        question: "You pay 5 dollars for a 3 dollar list. How many dollars in change?",
        acceptedNumbers: [2],
        onCorrect: "Right — 2 dollars back in your pocket.",
        stuckReply:
          "Good try — change is the difference. Start from what you paid: 5. Take the cost away: 5 − 3. How many dollars is that?",
      },
    },
    {
      id: "snack-change",
      concept: "change in cents",
      spoken: "Last one. A 75 cent snack, paid with a dollar — 25 cents back.",
      teaching:
        "A snack costs 75 cents. You pay with a one dollar bill — that's 100 cents.\n\n100 − 75 = 25.\n\n25 cents come back. One quarter, if you like.",
      check: {
        question: "The snack is 75 cents and you pay with 100 cents. How many cents come back?",
        acceptedNumbers: [25],
        onCorrect: "That's the whole skill — 25 cents back, maybe a quarter in your hand.",
        stuckReply:
          "You're close. Count up from 75 to 100: that's 25 more. Or take 75 from 100. How many cents is that?",
      },
    },
  ],
};
