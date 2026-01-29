import { QuizAnswer, QUIZ_QUESTIONS } from "../models/types.js";

export class QuizService {
  /**
   * Returns the next unanswered question for a partner, or null if all done.
   */
  getNextQuestion(answers: QuizAnswer[]): (typeof QUIZ_QUESTIONS)[number] | null {
    const answeredIds = new Set(answers.map((a) => a.questionId));
    return QUIZ_QUESTIONS.find((q) => !answeredIds.has(q.id)) ?? null;
  }

  /**
   * Records an answer. Returns true if valid, false if question already answered
   * or question ID is invalid.
   */
  submitAnswer(
    answers: QuizAnswer[],
    questionId: number,
    answer: string
  ): { success: boolean; error?: string } {
    const question = QUIZ_QUESTIONS.find((q) => q.id === questionId);
    if (!question) {
      return { success: false, error: `Invalid question ID: ${questionId}` };
    }
    if (answers.some((a) => a.questionId === questionId)) {
      return {
        success: false,
        error: `Question ${questionId} already answered`,
      };
    }
    // Accept the answer even if not in predefined options (for "Other")
    answers.push({ questionId, answer });
    return { success: true };
  }

  /**
   * Checks if all questions have been answered.
   */
  isComplete(answers: QuizAnswer[]): boolean {
    return answers.length >= QUIZ_QUESTIONS.length;
  }
}

export const quizService = new QuizService();
