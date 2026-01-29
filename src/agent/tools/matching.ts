import { FunctionTool } from "@google/adk";
import { z } from "zod";
import { roomService } from "../../services/room.js";
import { QUIZ_QUESTIONS, MatchResult, QuestionMatch } from "../../models/types.js";
import { currentContext } from "./context.js";

// Compatibility maps for each question category
const COMPATIBILITY_MAPS: Record<string, Record<string, string[]>> = {
  cuisine: {
    "North Indian": ["Street Food", "South Indian"],
    "South Indian": ["North Indian", "Street Food"],
    Chinese: ["Italian", "Sushi/Asian"],
    Italian: ["Continental", "Chinese"],
    Continental: ["Italian", "Fine Dining"],
    "Street Food": ["North Indian", "South Indian"],
  },
  spice: {
    Mild: ["Medium"],
    Medium: ["Mild", "Spicy"],
    Spicy: ["Medium", "Extra Spicy"],
    "Extra Spicy": ["Spicy"],
  },
  diet: {
    Veg: ["Vegan", "Egg only"],
    "Non-Veg": ["Egg only"],
    "Egg only": ["Veg", "Non-Veg"],
    Vegan: ["Veg"],
  },
  budget: {
    "₹200-400": ["₹400-700"],
    "₹400-700": ["₹200-400", "₹700-1200"],
    "₹700-1200": ["₹400-700", "₹1200+"],
    "₹1200+": ["₹700-1200"],
  },
  mood: {
    "Cozy & Romantic": ["Fine Dining"],
    "Fun & Casual": ["Home-cooked"],
    "Fine Dining": ["Cozy & Romantic"],
    "Home-cooked": ["Fun & Casual", "Cozy & Romantic"],
  },
  dish_type: {
    "Biriyani/Rice": ["Curry & Bread"],
    "Pizza/Pasta": ["Sushi/Asian"],
    "Curry & Bread": ["Biriyani/Rice"],
    "Sushi/Asian": ["Pizza/Pasta", "Healthy/Salad"],
    "Dessert-heavy": ["Pizza/Pasta"],
    "Healthy/Salad": ["Sushi/Asian"],
  },
};

function calculateQuestionScore(
  category: string,
  answer1: string,
  answer2: string
): number {
  if (answer1 === answer2) return 100;
  const compatibles = COMPATIBILITY_MAPS[category]?.[answer1] ?? [];
  if (compatibles.includes(answer2)) return 60;
  return 20;
}

export const calculateMatchTool = new FunctionTool({
  name: "calculate_match",
  description:
    "Calculate the taste compatibility between two partners. Both partners must have completed the quiz. Returns compatibility percentage and breakdown.",
  parameters: z.object({}),
  execute: async () => {
    const room = roomService.getRoom(currentContext.roomId);
    if (!room) return { error: "Room not found" };
    if (!room.partner2) return { error: "Partner 2 has not joined yet" };
    if (!room.partner1.quizComplete || !room.partner2.quizComplete)
      return { error: "Both partners must complete the quiz first" };

    const breakdown: QuestionMatch[] = [];
    let totalScore = 0;

    for (const question of QUIZ_QUESTIONS) {
      const p1Answer = room.partner1.quizAnswers.find(
        (a) => a.questionId === question.id
      );
      const p2Answer = room.partner2.quizAnswers.find(
        (a) => a.questionId === question.id
      );
      if (!p1Answer || !p2Answer) continue;

      const score = calculateQuestionScore(
        question.category,
        p1Answer.answer,
        p2Answer.answer
      );
      totalScore += score;
      breakdown.push({
        questionId: question.id,
        partner1Answer: p1Answer.answer,
        partner2Answer: p2Answer.answer,
        score,
      });
    }

    const maxScore = QUIZ_QUESTIONS.length * 100;
    const compatibility = Math.round((totalScore / maxScore) * 100);

    const sharedPreferences: string[] = [];
    for (const match of breakdown) {
      if (match.score >= 60) {
        const q = QUIZ_QUESTIONS.find((q) => q.id === match.questionId);
        if (match.score === 100) {
          sharedPreferences.push(`Both love ${match.partner1Answer}`);
        } else {
          sharedPreferences.push(
            `${match.partner1Answer} & ${match.partner2Answer} (${q?.category})`
          );
        }
      }
    }

    const matchResult: MatchResult = {
      compatibility,
      breakdown,
      recommendations: [
        {
          type: "delivery",
          title: "Order In Together",
          description: `Order a romantic dinner for two from Swiggy!`,
          matchedPreferences: sharedPreferences,
        },
        {
          type: "dineout",
          title: "Dine Out Date Night",
          description: `Book a table at a restaurant that matches your combined tastes!`,
          matchedPreferences: sharedPreferences,
        },
        {
          type: "cook",
          title: "Cook Together at Home",
          description: `Get ingredients from Swiggy Instamart and cook a romantic meal!`,
          matchedPreferences: sharedPreferences,
        },
      ],
    };

    room.matchResult = matchResult;

    return {
      compatibility,
      breakdown: breakdown.map((b) => {
        const q = QUIZ_QUESTIONS.find((q) => q.id === b.questionId);
        return {
          question: q?.text,
          category: q?.category,
          partner1: b.partner1Answer,
          partner2: b.partner2Answer,
          matchScore: b.score,
        };
      }),
      sharedPreferences,
      recommendations: matchResult.recommendations,
      message:
        compatibility >= 80
          ? `A PERFECT food match at ${compatibility}%!`
          : compatibility >= 50
            ? `A solid ${compatibility}% match!`
            : `A ${compatibility}% match — opposites attract!`,
    };
  },
});

export const getRecipeTool = new FunctionTool({
  name: "get_recipe",
  description:
    "Generate a Valentine's recipe suggestion based on the couple's preferences. Use when the couple chooses to cook at home.",
  parameters: z.object({
    cuisine_preference: z.string().optional().describe("Optional cuisine override"),
  }),
  execute: async ({ cuisine_preference }) => {
    const room = roomService.getRoom(currentContext.roomId);
    if (!room) return { error: "Room not found" };
    if (!room.matchResult) return { error: "Match not calculated yet" };

    const p1Cuisine = room.partner1.quizAnswers.find((a) => a.questionId === 1)?.answer;
    const p2Cuisine = room.partner2?.quizAnswers.find((a) => a.questionId === 1)?.answer;
    const p1Diet = room.partner1.quizAnswers.find((a) => a.questionId === 3)?.answer;
    const p2Diet = room.partner2?.quizAnswers.find((a) => a.questionId === 3)?.answer;

    const cuisine = cuisine_preference ?? p1Cuisine ?? p2Cuisine ?? "Italian";
    const isVeg = p1Diet === "Veg" || p2Diet === "Veg" || p1Diet === "Vegan" || p2Diet === "Vegan";

    const recipes: Record<string, object> = {
      "North Indian": {
        name: isVeg ? "Paneer Tikka with Rose Kulfi" : "Butter Chicken with Garlic Naan & Rose Kulfi",
        ingredients: isVeg
          ? ["Paneer 400g", "Yogurt", "Tikka masala", "Bell peppers", "Onions", "Rose syrup", "Milk", "Cream", "Cardamom", "Pistachios"]
          : ["Chicken 500g", "Butter", "Tomato puree", "Cream", "Garlic naan", "Rose syrup", "Milk", "Cardamom", "Pistachios"],
        steps: ["Marinate protein in yogurt and spices", "Cook with butter and cream sauce", "Prepare rose kulfi", "Serve with love!"],
      },
      Italian: {
        name: isVeg ? "Truffle Mushroom Risotto with Tiramisu" : "Lobster Pasta with Tiramisu",
        ingredients: isVeg
          ? ["Arborio rice", "Mushrooms", "Truffle oil", "Parmesan", "White wine", "Mascarpone", "Coffee", "Ladyfinger biscuits", "Cocoa powder"]
          : ["Pasta", "Lobster/Prawns", "Garlic", "White wine", "Cherry tomatoes", "Basil", "Mascarpone", "Coffee", "Ladyfinger biscuits"],
        steps: ["Prepare the main course", "Make tiramisu layers", "Chill tiramisu 2+ hours", "Light candles and enjoy!"],
      },
    };

    return {
      recipe: recipes[cuisine] ?? {
        name: `Valentine's Special ${cuisine} Feast`,
        ingredients: ["Check Swiggy Instamart for fresh ingredients!", "Don't forget dessert ingredients"],
        steps: ["Search Instamart for ingredients", "Cook together!", "Set up a romantic table", "Enjoy!"],
      },
      cuisine,
      isVegetarian: isVeg,
      tip: "Use Swiggy Instamart to order all ingredients with quick delivery!",
    };
  },
});

export const matchingTools = [calculateMatchTool, getRecipeTool];
