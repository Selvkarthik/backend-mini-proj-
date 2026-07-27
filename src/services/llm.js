const MODEL = 'deepseek/deepseek-v4-flash';

async function chatCompletion(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.7 }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text().catch(() => '')}`);

    const json = await res.json();
    return json.choices[0].message.content;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('AI request timed out after 20s');
    throw err;
  }
}

module.exports = { chatCompletion };