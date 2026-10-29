/**
 * src/services/actions/actionGenerators.ts
 */

import { CITATION_INSTRUCTION } from '../../../shared/prompts';

/**
 * Wraps a free-form student question with strict BLUF (Bottom Line Up Front),
 * adaptive word-count caps, inline citation requirements, and anti-boilerplate constraints.
 */
export function buildDirectAnswerPrompt(userQuery: string, courseName?: string): string {
  const courseContext = courseName ? ` for "${courseName}"` : '';
  const trimmedQuery = userQuery?.trim() ?? '';

  return (
    `Answer the following student question${courseContext} using ONLY the provided Brightspace course materials.\n\n` +
    `Question: "${trimmedQuery}"\n\n` +
    `STRICT DIRECT ANSWER CONSTRAINTS:\n` +
    `1. BLUF (Bottom Line Up Front): Start at character 0 with the exact fact, date, grade, or answer. Do NOT echo, restate, or paraphrase the question.\n` +
    `2. Zero Boilerplate: Absolutely no greetings ("Hello!"), pleasantries, preambles ("Based on the provided course materials...", "Here is the answer:"), or closing remarks ("Hope this helps!").\n` +
    `3. Conciseness Caps:\n` +
    `   - For single-fact answers (dates, deadlines, weights, definitions): 1 sentence, maximum 25 words.\n` +
    `   - For multi-item or procedural answers: use a compact Markdown table or telegraphic bullet list (maximum 15 words per bullet).\n` +
    `4. Inline Citations: ${CITATION_INSTRUCTION}\n` +
    `5. Strict Grounding: If the information is not present in the provided materials, output strictly: "Not specified in the selected Brightspace materials." Never fabricate facts or generic advice.`
  );
}
