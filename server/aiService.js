// server/aiService.js
// Calls Anthropic API via fetch. Reads ANTHROPIC_API_KEY from process.env.
// Model: claude-haiku-4-5-20251001 (fast, cheap)

export const AI_MODEL = 'claude-haiku-4-5-20251001';

// Published Anthropic prices in US cents per million tokens, used only to
// estimate the AI cost of each order. The Anthropic Console bill is the
// source of truth; update this when the model or its price changes.
export const AI_MODEL_RATES = {
  'claude-haiku-4-5-20251001': { inputCentsPerMillion: 100, outputCentsPerMillion: 500 },
};

export function estimateAiCostCents({ model = AI_MODEL, inputTokens = 0, outputTokens = 0 } = {}) {
  const rates = AI_MODEL_RATES[model] || AI_MODEL_RATES[AI_MODEL];
  const cents =
    ((Number(inputTokens) || 0) * rates.inputCentsPerMillion +
      (Number(outputTokens) || 0) * rates.outputCentsPerMillion) /
    1000000;
  return Math.round(cents * 10000) / 10000;
}

// Returns { text, usage }; usage is { model, inputTokens, outputTokens, costCents }.
async function callClaude(prompt, maxTokens = 1024) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    // Bounded so two attempts always finish well inside the server's
    // 10-minute stale-claim window (AI_ORDER_STALE_MINUTES).
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const inputTokens = Number(data?.usage?.input_tokens) || 0;
  const outputTokens = Number(data?.usage?.output_tokens) || 0;
  const usage = {
    model: AI_MODEL,
    inputTokens,
    outputTokens,
    costCents: estimateAiCostCents({ model: AI_MODEL, inputTokens, outputTokens }),
  };
  return { text: data?.content?.[0]?.text || '', usage, stopReason: data?.stop_reason };
}

// Errors raised after Anthropic answered carry the usage, so the caller can
// still record what the failed attempt cost.
function errorWithUsage(message, usage) {
  const error = new Error(message);
  error.usage = usage;
  return error;
}

export async function generateCoverLetter({ jobTitle, jobDescription, userName, userBackground }) {
  const prompt = `Write a professional cover letter for ${userName} applying for the ${jobTitle} position.

Their background: ${userBackground}

Job description: ${jobDescription}

Requirements:
- Proper letter format (no date/address lines needed)
- Exactly 3 paragraphs
- ~300 words
- No placeholder brackets like [Company Name]
- Professional and specific to the role`;

  const { text, usage } = await callClaude(prompt, 1024);
  const letterText = text.trim();
  if (!letterText) throw errorWithUsage('Anthropic returned an empty cover letter', usage);
  return { letterText, usage };
}

// Reads [{ question, answer }] from the model's reply, tolerating a code fence
// or stray text around the JSON array.
export function parseInterviewQuestions(text) {
  const raw = String(text || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) throw new Error('No JSON array in the reply');

  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('The reply is not a JSON array');

  const questions = parsed
    .filter((item) => item && typeof item.question === 'string' && typeof item.answer === 'string')
    .map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }))
    .filter((item) => item.question && item.answer);
  if (!questions.length) throw new Error('The reply has no questions');
  return questions;
}

export async function generateInterviewPrep({ jobTitle, jobDescription }) {
  const prompt = `Generate 10 common interview questions and answers for a ${jobTitle} role.

Job description: ${jobDescription}

Return ONLY a JSON array with no other text, in this exact format:
[{"question": "...", "answer": "..."}, ...]

Requirements:
- Questions specific to the ${jobTitle} role
- Answers 2-3 sentences each
- Mix of behavioral, technical, and situational questions`;

  const { text, usage, stopReason } = await callClaude(prompt, 3000);
  if (stopReason === 'max_tokens') {
    throw errorWithUsage('Interview prep reply was cut off (hit the max_tokens limit)', usage);
  }
  try {
    return { questions: parseInterviewQuestions(text), usage };
  } catch (error) {
    throw errorWithUsage(`Could not read the interview prep reply: ${error.message}`, usage);
  }
}

// Polished job description from a title and the employer's rough notes.
// Only facts from the notes are used, so pay, schedule and benefits are never
// invented; the posting guidelines' banned phrasing is spelled out too.
export async function generateJobDescription({ jobTitle, notes, businessName, city }) {
  const prompt = `Write a job description for a ${jobTitle} position${businessName ? ` at ${businessName}` : ''}${city ? ` in ${city}` : ''}, to be posted on a local job board for Tarboro and Edgecombe County, North Carolina.

Employer's notes (the only facts you may use):
${notes || '(none)'}

Requirements:
- Plain text, no markdown symbols like # or **
- Short intro paragraph, then "Responsibilities:" and "Requirements:" sections with lines starting "- "
- 150-300 words, friendly and clear for local job seekers
- Do not invent pay, hours, benefits or contact details that are not in the notes
- Never mention age, sex, religion, disability, pregnancy, citizenship or national origin preferences, application fees, bank details, SSN, Telegram, WhatsApp or crypto
- Return only the description`;

  const { text, usage } = await callClaude(prompt, 1024);
  const description = text.trim();
  if (!description) throw errorWithUsage('Anthropic returned an empty job description', usage);
  return { description, usage };
}
