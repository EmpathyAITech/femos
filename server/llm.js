// Model-agnostic LLM adapter (OpenAI-compatible chat API: Ollama, vLLM, llama.cpp server,
// LM Studio, or any hosted endpoint a partner's policy allows). Open-weight by default.
// LLM output is never trusted directly: every extracted value must quote the input verbatim,
// and is type-checked against the protocol pack. If no model is configured, FEMOS uses the
// deterministic rule-based agents.

const BASE = process.env.FEMOS_LLM_BASE ?? '';
const MODEL = process.env.FEMOS_LLM_MODEL ?? '';
const KEY = process.env.FEMOS_LLM_KEY ?? '';

export const llmConfigured = () => !!(BASE && MODEL);
export const llmInfo = () => (llmConfigured() ? { base: BASE.replace(/\/\/[^@]*@/, '//'), model: MODEL } : null);

async function chat(messages, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0, response_format: { type: 'json_object' } }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content ?? '';
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } finally {
    clearTimeout(timer);
  }
}

/** Grounded extraction: returns {answers, spans} using only values the input supports. */
export async function llmExtract(text, pack) {
  const items = pack.questionnaire.items.map((i) => `- ${i.linkId} (${i.type}${i.options ? `: ${i.options.join('|')}` : ''}): ${i.text.en}`).join('\n');
  const sys = `You extract fields for a women's health intake form from what a health worker or patient wrote or said (English, Hindi, Bengali, Marathi or Tamil, in native script or romanised, often mixed with English).
Rules: Only extract what is explicitly stated. Never infer a "no" from silence. Never diagnose or advise.
For every field you return, include "quote": the exact substring of the input that supports it.
Return JSON: {"fields":[{"linkId":"...","value":...,"quote":"..."}]}.
Fields:\n${items}`;
  const out = await chat([{ role: 'system', content: sys }, { role: 'user', content: text }]);
  const answers = {};
  const spans = [];
  const dropped = [];
  for (const f of out.fields ?? []) {
    const item = pack.questionnaire.items.find((i) => i.linkId === f.linkId);
    const q = String(f.quote ?? '');
    const start = q ? text.indexOf(q) : -1;
    let v = f.value;
    if (item?.type === 'integer') v = Number.isInteger(Number(v)) ? Number(v) : undefined;
    if (item?.type === 'boolean') v = typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined;
    if (item?.type === 'choice' && !item.options.includes(v)) v = undefined;
    if (item?.type === 'integer' && v !== undefined && ((item.min != null && v < item.min) || (item.max != null && v > item.max))) v = undefined;
    if (!item || v === undefined || start < 0) { dropped.push({ ...f, why: !item ? 'unknown field' : start < 0 ? 'quote not found in input' : 'invalid value' }); continue; }
    answers[item.linkId] = v;
    spans.push({ field: item.linkId, value: v, text: q, start, end: start + q.length });
  }
  return { answers, spans, dropped, extractedBy: `llm:${MODEL}` };
}

/** Map a supervisor question to structured filters (the numbers are computed elsewhere). */
export async function llmPlanQuery(question, intentIds, places) {
  const sys = `Map the question to filters. Allowed intents: ${intentIds.join(', ')}. Allowed places: ${places.join(', ') || 'none'}.
Allowed periods: this_month, last_month, all. Return JSON {"intents":[...],"place":null|"...","period":"..."}. Never answer the question yourself.`;
  const out = await chat([{ role: 'system', content: sys }, { role: 'user', content: question }], { timeoutMs: 12000 });
  return {
    intents: (out.intents ?? []).filter((i) => intentIds.includes(i)),
    place: places.includes(out.place) ? out.place : null,
    period: ['this_month', 'last_month', 'all'].includes(out.period) ? out.period : 'all',
  };
}
