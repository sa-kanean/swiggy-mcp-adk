import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "" });

/**
 * Generate a cartoon couple portrait from two selfie photos using Gemini image generation.
 */
export async function generateCartoonCouple(
  photo1Base64: string,
  photo1Mime: string,
  name1: string,
  photo2Base64: string,
  photo2Mime: string,
  name2: string,
  compatibility: number
): Promise<string> {
  const prompt = `Create an adorable animated cartoon-style couple portrait of these two people together.
Make it a warm, romantic Valentine's Day themed illustration with:
- Both people drawn in a cute animated/cartoon style (like Pixar or Studio Ghibli)
- Hearts and romantic elements in the background
- A warm, vibrant color palette
- Both characters smiling and looking happy together
- Their compatibility score of ${compatibility}% subtly incorporated
- Names "${name1}" and "${name2}" could be on a small banner or heart

Style: Cute cartoon couple portrait, Valentine's Day theme, colorful, joyful, animated style.
Keep the likeness of both people from the photos but in cartoon form.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: photo1Mime,
              data: photo1Base64,
            },
          },
          {
            inlineData: {
              mimeType: photo2Mime,
              data: photo2Base64,
            },
          },
          { text: prompt },
        ],
      },
    ],
    config: {
      responseModalities: ["IMAGE", "TEXT"],
    } as any,
  });

  // Extract image from response
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error("No response parts from Gemini");
  }

  for (const part of parts) {
    if ((part as any).inlineData) {
      const inlineData = (part as any).inlineData;
      return inlineData.data; // base64 string
    }
  }

  throw new Error("No image generated in Gemini response");
}
