const { chatCompletion } = require('./llm');

const RESUME_JSON_SCHEMA = `{
  "name": "string - full name",
  "title": "string - job title / professional title",
  "contact": {
    "phone": "string",
    "email": "string",
    "github": ["array of github urls or empty array"],
    "linkedin": "string - linkedin url",
    "location": "string - city, state"
  },
  "summary": "string - professional summary tailored to target role",
  "skills": {
    "Category Name": ["skill1", "skill2"]
  },
  "experience": [
    {
      "role": "string - job title",
      "company": "string",
      "location": "string",
      "period": "string - e.g. Jul 2024 - May 2026",
      "stack": "string - tech stack used",
      "projects": [
        {
          "name": "string",
          "tech": "string",
          "bullets": ["string - achievement-oriented bullet point"]
        }
      ]
    }
  ],
  "projects": [
    {
      "name": "string",
      "role": "string",
      "links": {},
      "tech": "string",
      "bullets": ["string"]
    }
  ],
  "education": [
    {
      "degree": "string",
      "institution": "string",
      "period": "string",
      "grade": "string"
    }
  ],
  "certifications": [
    {
      "name": "string",
      "issuer": "string"
    }
  ],
  "publications": [
    {
      "title": "string",
      "publisher": "string",
      "date": "string",
      "url": "string",
      "summary": "string"
    }
  ],
  "additional": {
    "languages": ["string"],
    "availability": "string"
  }
}`;

const EXTRACTION_PROMPT = `You are a resume parsing expert. Extract structured data from the following resume text and return ONLY a valid JSON object matching this exact schema — no markdown, no code fences, no explanation:

${RESUME_JSON_SCHEMA}

IMPORTANT RULES:
- Extract ALL information you can find from the resume text
- Group skills into meaningful categories (e.g. "Languages", "Frontend", "Backend", "Cloud & DevOps", etc.)
- For experience, group related work under projects if the resume describes multiple projects within one role
- For fields you cannot find in the resume, use empty strings or empty arrays as appropriate
- Use the "period" format like "Jul 2024 - May 2026" for dates
- Keep all bullet points from the original resume

Resume text:
"""
RESUME_TEXT_PLACEHOLDER
"""

Return ONLY the JSON object. No extra text.`;

async function parseResumeWithLLM(text) {
  const prompt = EXTRACTION_PROMPT.replace('RESUME_TEXT_PLACEHOLDER', text);
  try {
    const raw = await chatCompletion([{ role: 'user', content: prompt }]);
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.split('\n', 1)[1];
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();
    }
    return JSON.parse(cleaned);
  } catch (err) {
    return { error: 'Failed to parse resume', raw_text: text };
  }
}

function buildSystemPrompt(profile) {
  const base = `You are an expert AI career assistant and resume builder. You help users craft the best possible resume tailored to specific job postings.

Your capabilities:
1. Answer questions about the user's background and experience
2. Provide career advice and job search tips
3. When the user shares a job posting (or any job description / job role), generate a tailored resume that best matches the job requirements
4. Highlight relevant skills, reword experience to match the job, and optimize the professional summary

IMPORTANT RULES FOR RESUME GENERATION:
- When given a job posting or job description, generate a COMPLETE tailored resume
- Rewrite the summary to target the specific role
- Reorder and emphasize skills that match the job requirements
- Rewrite experience bullet points to align with the job description
- Keep the resume truthful — only rephrase, never fabricate experience
- The resume JSON MUST be wrapped in <resume_json> and </resume_json> tags
- Include explanatory text before AND after the JSON explaining what changes you made and why
- Always follow the exact JSON schema provided below

OUTPUT FORMAT when generating a tailored resume:
1. First, write a brief explanation of your approach
2. Then output the resume JSON wrapped in tags like this:
<resume_json>
{ "name": "...", "title": "...", ... }
</resume_json>
3. After the JSON, explain what specific changes you made and why they match the target role

OUTPUT JSON SCHEMA for the resume:`;

  if (!profile) {
    return base + '\n\nNo user profile has been set up yet. Ask the user to upload their resume or fill in their profile first.';
  }

  const parts = [base, '', '--- USER PROFILE (Resume JSON) ---'];

  const resumeJson = profile.resume_json;
  if (resumeJson && resumeJson.error) {
    parts.push('(Resume JSON parsing failed. Using raw text instead.)');
  } else if (resumeJson) {
    parts.push(JSON.stringify(resumeJson, null, 2));
  }

  if (profile.resume_text) {
    parts.push('');
    parts.push('--- RAW RESUME TEXT ---');
    parts.push(profile.resume_text.substring(0, 3000));
  }

  parts.push('');
  parts.push('--- OUTPUT FORMAT ---');
  parts.push('When asked to generate/tailor a resume, use this exact JSON schema:');
  parts.push(RESUME_JSON_SCHEMA);
  parts.push('');
  parts.push('When the user pastes a job posting or job description, analyze the job requirements and produce a tailored resume that matches the role. Always wrap the JSON in <resume_json> tags and explain what changes you made and why.');

  return parts.join('\n');
}

module.exports = { parseResumeWithLLM, buildSystemPrompt, RESUME_JSON_SCHEMA };
