import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');

export function getModel() {
  return genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

export function getEmbeddingModel() {
  return genAI.getGenerativeModel({ model: 'text-embedding-004' });
}

export async function embedText(text) {
  try {
    const result = await getEmbeddingModel().embedContent(text);
    return result.embedding.values;
  } catch (e) {
    console.error('Embedding failed:', e.message);
    return null;
  }
}

export async function extractFromText(text) {
  const model = getModel();
  const prompt = `You are a document extraction engine for a family office platform called LedgerLayer. 
Extract structured data from the following document text. Return ONLY valid JSON with this shape:

{
  "entities": [{ "name": "...", "type": "company|trust|property|wrapper", "meta": "...", "people": [{ "name": "...", "role": "..." }] }],
  "people": [{ "name": "...", "role": "...", "entities": ["..."] }],
  "obligations": [{ "title": "...", "due": "DD Mon YYYY", "entity": "...", "assignee": "..." }],
  "documents": [{ "name": "...", "type": "corporate|legal|tax|accounts|property|compliance|pension|investment|insurance", "entity": "..." }]
}

If you cannot determine a value, omit it. Do not fabricate data you cannot infer from the text.
Respond with ONLY the JSON object, no other text.

Document text:
${text}`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text_response = response.text().trim();
    const jsonMatch = text_response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (e) {
    console.error('Extraction failed:', e.message);
    return null;
  }
}

export async function answerQuery(query, context, conversationHistory) {
  const model = getModel();

  const historyText = conversationHistory && conversationHistory.length
    ? '\n\nPrevious conversation:\n' + conversationHistory.map(h => `User: ${h.query}\nAssistant: ${h.response.text.slice(0, 500)}`).join('\n')
    : '';

  const prompt = `You are LedgerLayer Intelligence — an AI assistant for a family office platform. 
You have full access to the household's authoritative record. Answer concisely, cite specific data points, and be direct.

HOUSEHOLD DATA:
${JSON.stringify(context, null, 2)}${historyText}

USER QUESTION: ${query}

Guidelines:
- Answer based ONLY on the household data provided above.
- Use **bold** for entity names, people, and important numbers.
- If the data doesn't contain the answer, say so plainly.
- Suggest 2-3 follow-up questions the user might want to ask next.
- Keep answers to 2-4 paragraphs unless the question requires more depth.`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (e) {
    console.error('Query failed:', e.message);
    return 'I encountered an error processing your question. Please try again.';
  }
}
