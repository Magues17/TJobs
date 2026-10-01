// server/aiService.js
// Calls Anthropic API via fetch. Reads ANTHROPIC_API_KEY from process.env.
// Model: claude-haiku-4-5-20251001 (fast, cheap)

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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content[0].text;
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

  return callClaude(prompt, 1024);
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

  const text = await callClaude(prompt, 2048);
  return JSON.parse(text);
}
