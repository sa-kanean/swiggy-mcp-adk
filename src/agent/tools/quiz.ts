import { FunctionTool } from "@google/adk";
import { z } from "zod";
import { roomService } from "../../services/room.js";
import { quizService } from "../../services/quiz.js";
import { QUIZ_QUESTIONS } from "../../models/types.js";
import { currentContext } from "./context.js";

export const startQuizTool = new FunctionTool({
  name: "start_quiz",
  description:
    "Start the Valentine's taste quiz for the current user. Returns the first question. Call this when a partner is ready to begin the quiz.",
  parameters: z.object({}),
  execute: async () => {
    const room = roomService.getRoom(currentContext.roomId);
    if (!room) return { error: "Room not found" };

    const partner = roomService.getPartner(room, currentContext.userId);
    if (!partner) return { error: "User not found in room" };

    if (partner.quizComplete) {
      return { message: "Quiz already completed for this partner" };
    }

    const nextQuestion = quizService.getNextQuestion(partner.quizAnswers);
    if (!nextQuestion) {
      partner.quizComplete = true;
      return { message: "All questions already answered" };
    }

    return {
      message: `Quiz started for ${partner.name}!`,
      question: {
        id: nextQuestion.id,
        text: nextQuestion.text,
        category: nextQuestion.category,
        options: nextQuestion.options,
      },
      totalQuestions: QUIZ_QUESTIONS.length,
      currentQuestion: 1,
    };
  },
});

export const submitAnswerTool = new FunctionTool({
  name: "submit_answer",
  description:
    "Submit a quiz answer for the current user. Returns the next question or indicates completion.",
  parameters: z.object({
    question_id: z.number().describe("The question ID being answered"),
    answer: z.string().describe("The partner's answer"),
  }),
  execute: async ({ question_id, answer }) => {
    const room = roomService.getRoom(currentContext.roomId);
    if (!room) return { error: "Room not found" };

    const partner = roomService.getPartner(room, currentContext.userId);
    if (!partner) return { error: "User not found in room" };

    if (partner.quizComplete) {
      return { error: "Quiz already completed for this partner" };
    }

    const result = quizService.submitAnswer(
      partner.quizAnswers,
      question_id,
      answer
    );
    if (!result.success) return { error: result.error };

    if (quizService.isComplete(partner.quizAnswers)) {
      partner.quizComplete = true;
      const bothComplete =
        room.partner1.quizComplete &&
        (room.partner2?.quizComplete ?? false);

      return {
        message: `${partner.name} has completed the quiz!`,
        quizComplete: true,
        bothPartnersComplete: bothComplete,
        answeredCount: partner.quizAnswers.length,
        totalQuestions: QUIZ_QUESTIONS.length,
      };
    }

    const nextQuestion = quizService.getNextQuestion(partner.quizAnswers);
    return {
      message: "Answer recorded!",
      quizComplete: false,
      nextQuestion: nextQuestion
        ? {
            id: nextQuestion.id,
            text: nextQuestion.text,
            category: nextQuestion.category,
            options: nextQuestion.options,
          }
        : null,
      answeredCount: partner.quizAnswers.length,
      totalQuestions: QUIZ_QUESTIONS.length,
    };
  },
});

export const getQuizStatusTool = new FunctionTool({
  name: "get_quiz_status",
  description:
    "Get the current quiz status for the room, showing each partner's progress.",
  parameters: z.object({}),
  execute: async () => {
    const room = roomService.getRoom(currentContext.roomId);
    if (!room) return { error: "Room not found" };

    return {
      partner1: {
        name: room.partner1.name,
        answeredCount: room.partner1.quizAnswers.length,
        totalQuestions: QUIZ_QUESTIONS.length,
        complete: room.partner1.quizComplete,
      },
      partner2: room.partner2
        ? {
            name: room.partner2.name,
            answeredCount: room.partner2.quizAnswers.length,
            totalQuestions: QUIZ_QUESTIONS.length,
            complete: room.partner2.quizComplete,
          }
        : null,
      bothComplete:
        room.partner1.quizComplete &&
        (room.partner2?.quizComplete ?? false),
    };
  },
});

export const quizTools = [startQuizTool, submitAnswerTool, getQuizStatusTool];
