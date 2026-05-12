// pages/api/chat.js
// Uses Google Gemini Flash — FREE tier (1M tokens/day, no credit card needed)
// Get API key free at: aistudio.google.com → Get API key

import { SYSTEM_PROMPT } from '../../lib/systemPrompt';

const rateLimitMap = new Map();
const RATE_LIMIT = 20, RATE_WINDOW = 60000;

function isRateLimited(ip) {
  const now = Date.now(), entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++; rateLimitMap.set(ip, entry); return false;
}

function sanitize(text) {
  return typeof text === 'string' ? text.replace(/<[^>]*>/g, '').substring(0, 2000).trim() : '';
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length > 20) return false;
  return messages.every(m => m && ['user','assistant'].includes(m.role) &&
    typeof m.content === 'string' && m.content.length > 0 && m.content.length <= 2000);
}

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://australiaawardshub.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  const { messages } = req.body || {};
  if (!validateMessages(messages)) return res.status(400).json({ error: 'Invalid request.' });

  const cleanMessages = messages.map(m => ({ role: m.role, content: sanitize(m.content) }));
  const last = cleanMessages.at(-1)?.content || '';
  if (/ignore (previous|all) instructions|jailbreak|forget everything/i.test(last))
    return res.status(400).json({ error: 'I can only help with Australia scholarships and visa questions.' });

  const geminiHistory = cleanMessages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const userMessage = cleanMessages.at(-1).content;

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'API key not configured.' });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [...geminiHistory, { role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!geminiRes.ok) {
      console.error('Gemini error:', await geminiRes.text());
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const parsed = JSON.parse(raw);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
        } catch { /* skip */ }
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Chat error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong.' });
    else { res.write(`data: ${JSON.stringify({ error: 'Stream interrupted.' })}\n\n`); res.end(); }
  }
}
