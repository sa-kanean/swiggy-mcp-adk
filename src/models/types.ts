export interface Partner {
  userId: string;
  name: string;
  phone: string;
  quizAnswers: QuizAnswer[];
  quizComplete: boolean;
  photoData: string | null;
  photoMimeType: string | null;
}

export interface QuizAnswer {
  questionId: number;
  answer: string;
}

export interface MatchResult {
  compatibility: number;
  breakdown: QuestionMatch[];
  recommendations: Recommendation[];
}

export interface QuestionMatch {
  questionId: number;
  partner1Answer: string;
  partner2Answer: string;
  score: number;
}

export interface Recommendation {
  type: "delivery" | "dineout" | "cook";
  title: string;
  description: string;
  matchedPreferences: string[];
}

export interface Room {
  roomId: string;
  partner1: Partner;
  partner2: Partner | null;
  matchResult: MatchResult | null;
  sessionId: string;
  createdAt: number;
  chosenAction: "delivery" | "dineout" | "cook" | null;
  chosenBy: string | null; // userId of who chose
  cartoonImageBase64: string | null;
}

// WebSocket message types

export interface WSClientMessage {
  type: "message";
  text: string;
}

export interface WSServerMessage {
  type:
    | "agent_message"
    | "partner_joined"
    | "quiz_update"
    | "match_result"
    | "action_chosen"
    | "swiggy_auth_required"
    | "swiggy_auth_complete"
    | "photo_uploaded"
    | "error";
  text?: string;
  partner?: { name: string };
  status?: { partner1Complete: boolean; partner2Complete: boolean };
  compatibility?: number;
  recommendations?: Recommendation[];
  error?: string;
  action?: string; // "delivery" | "dineout" | "cook"
  chosenBy?: string; // name of who chose
  authUrl?: string; // OAuth authorization URL for Swiggy
  cartoonImage?: string; // base64 data URL for cartoon couple image
  photoUser?: string; // name of user who uploaded photo
}

// Quiz question definition

export interface QuizQuestion {
  id: number;
  text: string;
  category: string;
  options: string[];
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 1,
    text: "What's your go-to cuisine?",
    category: "cuisine",
    options: [
      "North Indian",
      "South Indian",
      "Chinese",
      "Italian",
      "Continental",
      "Street Food",
      "Other",
    ],
  },
  {
    id: 2,
    text: "How spicy do you like it?",
    category: "spice",
    options: ["Mild", "Medium", "Spicy", "Extra Spicy"],
  },
  {
    id: 3,
    text: "Any dietary preferences?",
    category: "diet",
    options: ["Veg", "Non-Veg", "Egg only", "Vegan"],
  },
  {
    id: 4,
    text: "What's your ideal dinner budget per person?",
    category: "budget",
    options: ["₹200-400", "₹400-700", "₹700-1200", "₹1200+"],
  },
  {
    id: 5,
    text: "What vibe are you feeling tonight?",
    category: "mood",
    options: [
      "Cozy & Romantic",
      "Fun & Casual",
      "Fine Dining",
      "Home-cooked",
    ],
  },
  {
    id: 6,
    text: "Pick your ideal Valentine's dish type",
    category: "dish_type",
    options: [
      "Biriyani/Rice",
      "Pizza/Pasta",
      "Curry & Bread",
      "Sushi/Asian",
      "Dessert-heavy",
      "Healthy/Salad",
    ],
  },
];
