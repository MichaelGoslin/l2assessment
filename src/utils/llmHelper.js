import Groq from 'groq-sdk';
import { z } from 'zod';

/**
 * LLM Helper for categorizing customer support messages
 * Using Groq API for AI-powered categorization, with a deterministic
 * keyword fallback when the API is unavailable or returns bad output.
 */

export const CATEGORIES = [
  "Billing Issue",
  "Technical Problem",
  "Service Complaint",
  "Feature Request",
  "General Inquiry",
  "Positive Feedback",
];

const URGENCY_LEVELS = ["High", "Medium", "Low"];
const SENTIMENTS = ["Hostile", "Negative", "Neutral", "Positive"];

const SYSTEM_PROMPT = `You triage customer support messages for a SaaS company.
Return ONLY a JSON object with these keys:
- "category": the main topic, exactly one of ${CATEGORIES.map(c => `"${c}"`).join(", ")}
- "secondary_categories": array of any other topics from the same list that the message also raises (empty array if none)
- "urgency": exactly one of "High", "Medium", "Low"
- "sentiment": exactly one of "Hostile", "Negative", "Neutral", "Positive"
- "churn_risk": true if the customer threatens to cancel, leave, switch providers, or dispute a charge; otherwise false
- "reasoning": one or two sentences explaining the category and urgency

Category definitions:
- Billing Issue: payments, charges, invoices, refunds, plan or subscription changes.
- Technical Problem: errors, bugs, outages, pages not loading, login or access problems.
- Service Complaint: complaints about our support itself, such as slow or missing replies or poor treatment.
- Feature Request: asking for new functionality or a change to how the product works.
- General Inquiry: questions about the product, company, or policies with no problem reported.
- Positive Feedback: praise or thanks with no request or problem.
If a message mixes topics, choose the one that blocks the customer most as "category" and list the rest in "secondary_categories".

Urgency is about business impact, not tone, length, or punctuation:
- High: outage, data loss, security concern, customer locked out, failed or duplicate payment, many users affected, cancellation threat, or a hostile customer asking for a manager.
- Medium: something is broken or wrong for one customer but they can keep working.
- Low: questions, feature requests, feedback, thanks.`;

/**
 * Shape of the model's JSON reply. Types are enforced here, in code,
 * rather than trusting the prompt. Values are normalized afterwards.
 */
const AiReplySchema = z.object({
  category: z.string().min(1),
  secondary_categories: z.array(z.string()).optional().default([]),
  urgency: z.string().optional(),
  sentiment: z.string().optional(),
  churn_risk: z.boolean().optional(),
  reasoning: z.string().optional(),
});

let groqClient = null;

// Create the client only when a real key is configured, so the app still
// loads (and uses the offline fallback) when no key is set.
function getGroqClient() {
  const apiKey = import.meta.env?.VITE_GROQ_API_KEY;
  if (!apiKey || apiKey === 'your_groq_api_key_here') return null;
  if (!groqClient) {
    groqClient = new Groq({
      apiKey,
      dangerouslyAllowBrowser: true // Required for browser-based calls (not recommended for production!)
    });
  }
  return groqClient;
}

// Case-insensitive match against an allowed list; null if not allowed.
const pick = (allowed, value) =>
  allowed.find(a => a.toLowerCase() === String(value ?? '').trim().toLowerCase()) ?? null;

/**
 * Parse and validate the model's JSON reply.
 * Throws if the reply is not JSON or has the wrong shape, so the caller
 * can fall back. An off-list category becomes "Unknown" so a person
 * reviews it instead of the ticket being silently misrouted.
 *
 * @param {string} content - Raw model output
 */
export function parseCategorization(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Model returned an empty reply');
  }

  let raw;
  try {
    raw = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model did not return JSON');
    raw = JSON.parse(match[0]);
  }

  const data = AiReplySchema.parse(raw);
  const category = pick(CATEGORIES, data.category) ?? "Unknown";
  const secondaryCategories = [...new Set(
    data.secondary_categories.map(c => pick(CATEGORIES, c)).filter(c => c && c !== category)
  )];

  return {
    category,
    secondaryCategories,
    urgency: pick(URGENCY_LEVELS, data.urgency),
    sentiment: pick(SENTIMENTS, data.sentiment),
    churnRisk: data.churn_risk ?? null,
    reasoning: data.reasoning?.trim() || "No reasoning returned by the model.",
  };
}

/**
 * Categorize a customer support message using Groq AI
 *
 * @param {string} message - The customer support message
 * @param {{ client?: object|null }} [options] - Inject a client (used by tests)
 */
export async function categorizeMessage(message, { client } = {}) {
  const groq = client === undefined ? getGroqClient() : client;
  if (!groq) {
    return getOfflineCategorization(message, 'No API key configured');
  }

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message }
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    return { ...parseCategorization(response.choices?.[0]?.message?.content), source: 'ai', fallbackReason: null };
  } catch (error) {
    console.warn('Groq API failed or returned invalid output, using offline categorization:', error.message);
    return getOfflineCategorization(message, `AI unavailable or invalid reply (${error.name === 'ZodError' ? 'wrong JSON shape' : error.message})`);
  }
}

const KEYWORD_RULES = [
  { category: "Billing Issue", pattern: /\b(bill(s|ing|ed)?|payments?|charged?|charges|invoices?|credit card|subscriptions?|refund(s|ed)?|plan|upgrade|downgrade|pricing)\b/gi },
  { category: "Technical Problem", pattern: /\b(bugs?|errors?|broken|not working|doesn'?t work|crash(es|ed|ing)?|down|server|loading|won'?t load|slow|timing out|timeout|can'?t access|locked out|connection lost|glitch|throws)\b/gi },
  { category: "Service Complaint", pattern: /\b(no (one )?(answer|response|reply)|still waiting|(emailed|called|contacted) (you )?(two|three|four|five|several|multiple|\d+) times|unacceptable|terrible service|worst (service|support)|manager|supervisor)\b/gi },
  { category: "Feature Request", pattern: /\b(feature|could you (add|build|make|support)|please add|would like to see|suggestion|wish|enhancement|would be (great|nice|useful|helpful)|add (a|an) [\w\s]{0,20}option)\b/gi },
];

const PRAISE = /\b(thank|thanks|appreciate|great (work|job)|love (it|your)|positive feedback|keep up)\b/i;
const PROBLEM = /\b(but|however|error|issue|problem|broken|can'?t|cannot|not working|down)\b/i;
const QUESTION = /\b(how|what|when|where|can i|is there|do you)\b|\?/i;

/**
 * Deterministic keyword categorization. Returns every category whose
 * keywords appear, in priority order, with the words that matched.
 *
 * @param {string} message
 * @returns {{ category: string, terms: string[] }[]}
 */
export function keywordCategories(message) {
  const text = message || '';
  if (PRAISE.test(text) && !PROBLEM.test(text)) {
    return [{ category: "Positive Feedback", terms: [text.match(PRAISE)[0].toLowerCase()] }];
  }

  const found = KEYWORD_RULES
    .map(rule => ({ category: rule.category, terms: [...new Set((text.match(rule.pattern) || []).map(t => t.toLowerCase()))] }))
    .filter(r => r.terms.length > 0);

  if (found.length === 0 && QUESTION.test(text)) {
    return [{ category: "General Inquiry", terms: ['question'] }];
  }
  return found;
}

function getOfflineCategorization(message, fallbackReason) {
  const matches = keywordCategories(message);
  const [primary, ...rest] = matches;

  return {
    category: primary?.category ?? "Unknown",
    secondaryCategories: rest.map(r => r.category),
    urgency: null,
    sentiment: null,
    churnRisk: null,
    reasoning: primary
      ? `Keyword match: ${matches.map(m => `${m.category} (${m.terms.join(', ')})`).join('; ')}.`
      : "No category keywords found. A person should review this message.",
    source: 'offline',
    fallbackReason,
  };
}
