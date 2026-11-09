/**
 * Urgency Scorer - Rule-based urgency calculation
 *
 * Urgency is driven by business impact signals in the message text
 * (outages, lockouts, failed payments, security), not by message length,
 * punctuation, politeness, or the time of day. Every level comes with the
 * signals that produced it so an agent can see why a ticket was ranked.
 */

const HIGH_SIGNALS = [
  { label: 'service outage', pattern: /\b(is|are|went|goes|been|seems?)\s+down\b|\bdown\s+(now|again|completely)\b|\b(server|site|app|system|service|website|api|database|production)\s+(is\s+)?down\b|\boutage\b|\boffline\b/i },
  { label: 'crash or lost connection', pattern: /\bcrash(ed|es|ing)?\b|\bconnection (lost|dropped|refused)\b|\blost connection\b/i },
  { label: 'customer cannot access account', pattern: /\b(can'?t|cannot|can not|unable to|couldn'?t)\s+(access|log ?in|login|sign ?in|get in)\b|\blocked out\b/i },
  { label: 'production impact', pattern: /\bproduction\b|\ball (of our |our )?(users|customers)\b|\beveryone\b/i },
  { label: 'data loss', pattern: /\b(data loss|lost (all|my|our) (data|work|files))\b|\bdata (is |was )?(gone|deleted|missing)\b/i },
  { label: 'security concern', pattern: /\b(security|breach|hacked|compromised|unauthori[sz]ed|fraud(ulent)?|phishing)\b/i },
  { label: 'failed or duplicate payment', pattern: /\bpayment (failed|declined|bounced)\b|\b(charged|billed) (twice|double|two times)\b|\bdouble[- ]charged?\b/i },
  { label: 'customer flagged as urgent', pattern: /\b(urgent|urgently|asap|emergency|immediately|critical)\b/i },
]

const MEDIUM_SIGNALS = [
  { label: 'error or bug', pattern: /\b(error|bug|glitch|broken|not working|doesn'?t work|isn'?t working|fail(s|ed|ing)?)\b/i },
  { label: 'page not loading', pattern: /\bwon'?t load\b|\bnot loading\b|\bkeeps? loading\b|\bloading forever\b|\btim(es|ing) out\b|\btimeout\b/i },
  { label: 'slow performance', pattern: /\b(slow|lag(gy|ging)?|freez(es|ing)|hangs?)\b/i },
  { label: 'billing problem', pattern: /\b(refund|overcharged|wrong (amount|charge)|charged|invoice is wrong|incorrect (bill|invoice))\b/i },
  { label: 'reported problem', pattern: /\b(issue|problem)\b/i },
]

/**
 * Score a message and explain the result.
 *
 * @param {string} message - The customer support message
 * @returns {{ level: 'High'|'Medium'|'Low', signals: string[] }}
 */
export function scoreUrgency(message) {
  const text = message || ''
  const high = HIGH_SIGNALS.filter(s => s.pattern.test(text)).map(s => s.label)
  if (high.length > 0) return { level: 'High', signals: high }

  const medium = MEDIUM_SIGNALS.filter(s => s.pattern.test(text)).map(s => s.label)
  if (medium.length > 0) return { level: 'Medium', signals: medium }

  return { level: 'Low', signals: [] }
}

const RANK = { Low: 0, Medium: 1, High: 2 }

/**
 * Final urgency: the rules act as a safety floor under the AI's judgement.
 * The AI can raise urgency for impact the keywords miss, but it can never
 * mark a detected outage, lockout or failed payment as less urgent.
 *
 * @param {string} message - The customer support message
 * @param {string|null} [aiUrgency] - Urgency suggested by the LLM, if any
 * @returns {{ level: 'High'|'Medium'|'Low', signals: string[] }}
 */
export function combineUrgency(message, aiUrgency = null) {
  const rules = scoreUrgency(message)
  if (aiUrgency && RANK[aiUrgency] > RANK[rules.level]) {
    return { level: aiUrgency, signals: [...rules.signals, 'AI assessed higher business impact'] }
  }
  return rules
}

/**
 * Backwards-compatible helper that returns only the level.
 *
 * @param {string} message
 * @returns {'High'|'Medium'|'Low'}
 */
export function calculateUrgency(message) {
  return scoreUrgency(message).level
}
