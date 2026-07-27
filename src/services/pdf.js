const pdf = require('pdf-parse');

async function extractTextFromPDF(buffer) {
  const data = await pdf(buffer);
  return (data.text || '').trim();
}

module.exports = { extractTextFromPDF };
