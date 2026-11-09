/**
 * Risk Signals - deterministic sentiment and churn-risk detection
 *
 * These rules run on every message, whether or not the AI is available,
 * so an angry customer or a cancellation threat is never missed because
 * the model was down or returned something unexpected.
 */

const CHURN_SIGNALS = [
  { label: 'cancellation threat', pattern: /\b(i'?m|we'?re|i am|we are|will be|going to|gonna|about to)\s+(cancel+(ing)?|leav(e|ing)|done with you)\b|\bor (i|we)('ll| will)? cancel\b|\bcancel+(ing|ed)? (my|our) (account|subscription|plan|contract)\b/i },
  { label: 'switching to a competitor', pattern: /\bswitch(ing)? (to|providers|vendors|tools)\b|\bmov(e|ing) to [A-Z][a-z]+|\b(competitor|alternative provider)\b|\bnot (going to )?renew(ing)?\b/i },
  { label: 'payment dispute', pattern: /\bchargeback\b|\bdisput(e|ing) (the|this|a) charge\b/i },
]

const HOSTILE_SIGNALS = [
  { label: 'asks for a manager', pattern: /\b(speak|talk) (to|with) (a|your|the) (manager|supervisor)\b|\b(get|want|need) (me )?(a|your|the) (manager|supervisor)\b|\bescalate this\b/i },
  { label: 'legal threat', pattern: /\b(lawyer|attorney|legal action|sue (you|your)|lawsuit|better business bureau|bbb)\b/i },
  { label: 'strong anger', pattern: /\b(unacceptable|ridiculous|outrageous|pathetic|incompetent|disgusted|furious|worst (service|company|support|experience)|scam)\b/i },
  { label: 'repeated unanswered contact', pattern: /\b(emailed|called|contacted|messaged|asked) (you )?(two|three|four|five|several|multiple|many|\d+) times\b|\bno (one )?(answer|response|reply)\b|\bstill waiting\b|\bnobody (has )?(answered|replied|responded)\b/i },
]

const NEGATIVE_SIGNALS = [
  { label: 'frustration', pattern: /\b(frustrat(ed|ing)|annoy(ed|ing)|disappoint(ed|ing)|upset|angry|fed up|sick of|tired of)\b/i },
  { label: 'recurring problem', pattern: /\b(again|still (broken|not working|happening|failing)|keeps happening|every time|second (time|month|week))\b/i },
]

const PRAISE = /\b(thank|thanks|appreciate|great (work|job|service)|love (it|your|the)|positive feedback|keep up|amazing|excellent)\b/i
const PROBLEM = /\b(but|however|error|issue|problem|broken|can'?t|cannot|not working|down|fail(ed|s|ing)?)\b/i

// Common acronyms are not shouting.
const ACRONYMS = new Set(['CSV', 'PDF', 'API', 'URL', 'SSO', 'FAQ', 'SMS', 'CRM', 'USA', 'CEO', 'CTO', 'SLA', 'IOS', 'HTML', 'JSON'])

function isShouting(message) {
  const capsWords = (message.match(/\b[A-Z]{3,}\b/g) || []).filter(w => !ACRONYMS.has(w))
  const letters = message.replace(/[^a-zA-Z]/g, '')
  const mostlyCaps = letters.length > 15 && letters === letters.toUpperCase()
  return mostlyCaps || capsWords.length >= 3
}

const match = (signals, text) => signals.filter(s => s.pattern.test(text)).map(s => s.label)

export const SENTIMENTS = ['Hostile', 'Negative', 'Neutral', 'Positive']

// Higher number = more concerning. Used to combine AI and rule results.
export const SENTIMENT_RANK = { Positive: 0, Neutral: 1, Negative: 2, Hostile: 3 }

/**
 * @param {string} message
 * @returns {{ sentiment: 'Hostile'|'Negative'|'Neutral'|'Positive', churnRisk: boolean, managerRequested: boolean, signals: string[] }}
 */
export function assessRisk(message) {
  const text = message || ''
  const churn = match(CHURN_SIGNALS, text)
  const hostile = match(HOSTILE_SIGNALS, text)
  const negative = match(NEGATIVE_SIGNALS, text)
  if (isShouting(text)) negative.push('shouting (all caps)')

  let sentiment = 'Neutral'
  if (hostile.length > 0) sentiment = 'Hostile'
  else if (negative.length > 0 || churn.length > 0) sentiment = 'Negative'
  else if (PRAISE.test(text) && !PROBLEM.test(text)) sentiment = 'Positive'

  return {
    sentiment,
    churnRisk: churn.length > 0,
    managerRequested: hostile.includes('asks for a manager') || hostile.includes('legal threat'),
    signals: [...churn, ...hostile, ...negative],
  }
}
