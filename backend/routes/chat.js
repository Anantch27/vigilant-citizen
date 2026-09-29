const express = require('express');
const fetch = require('node-fetch');

const router = express.Router();

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

const SYSTEM_PROMPT = `You are the Vigilant Citizen Assistant, a helpful civic-guidance AI embedded in an
Indian citizen-reporting platform. You help people:
- understand what counts as reportable civic misconduct (corruption, illegal fees, deforestation, etc.)
- write a clear, factual, non-defamatory report description from what they tell you
- understand the reporting and community-voting process on this platform
Keep answers concise, practical, and neutral. Never encourage vigilante action or violence.
If asked something unrelated to civic reporting, answer briefly and steer back to how the platform can help.`;

// POST /api/chat/stream  { message, history: [{role, text}] }
// Streams the Gemini response back to the client as Server-Sent Events so the
// UI can render text progressively instead of waiting for the full reply.
router.post('/chat/stream', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const { message, history } = req.body || {};

  if (!message) {
    return res.status(400).json({ ok: false, error: 'message is required.' });
  }

  if (!apiKey) {
    // Server-side misconfiguration — never expose this detail to the frontend
    // beyond a generic message, and never let a missing key crash the server.
    return res.status(500).json({
      ok: false,
      error: 'AI assistant is not configured. Set GEMINI_API_KEY on the server.',
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const contents = [];
  if (Array.isArray(history)) {
    for (const turn of history.slice(-10)) {
      contents.push({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(turn.text || '').slice(0, 2000) }],
      });
    }
  }
  contents.push({ role: 'user', parts: [{ text: String(message).slice(0, 2000) }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
      }),
    });

    if (!geminiRes.ok || !geminiRes.body) {
      const errText = await geminiRes.text().catch(() => '');
      console.error('Gemini API error:', geminiRes.status, errText);
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'AI service error. Please try again.' })}\n\n`);
      return res.end();
    }

    // Gemini's SSE stream sends lines like: data: {json chunk}
    // We parse each chunk and forward just the text delta to the client.
    let buffer = '';
    geminiRes.body.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last partial line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
          }
        } catch (e) {
          // ignore partial/non-JSON fragments
        }
      }
    });

    geminiRes.body.on('end', () => {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    geminiRes.body.on('error', (err) => {
      console.error('Stream error:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Connection lost.' })}\n\n`);
      res.end();
    });

    req.on('close', () => {
      geminiRes.body.destroy();
    });
  } catch (err) {
    console.error('Chat route error:', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'Internal server error.' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Internal server error.' })}\n\n`);
      res.end();
    }
  }
});

module.exports = router;
