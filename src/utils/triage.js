import { z } from 'zod'
import { categorizeMessage, keywordCategories, CATEGORIES } from './llmHelper.js'
import { combineUrgency } from './urgencyScorer.js'
import { assessRisk, SENTIMENTS, SENTIMENT_RANK } from './riskSignals.js'
import { getRecommendedAction, getRouteTeam, getEscalation, TEAMS, ESCALATION_TARGETS } from './templates.js'

/**
 * Triage pipeline
 *
 * 1. Ask the AI (or the offline keyword fallback) for category, urgency and sentiment.
 * 2. Run deterministic rules for urgency, sentiment and churn risk on every message.
 * 3. Combine them so the rules act as a floor: the AI can raise risk, never hide it.
 * 4. Score confidence from how much the AI and the rules agree.
 * 5. Validate the final result against TriageResultSchema before anything uses it.
 */

const URGENCY_RANK = { Low: 0, Medium: 1, High: 2 }

// Below this, a person should confirm the triage before it is acted on.
export const REVIEW_THRESHOLD = 0.5

export const TriageResultSchema = z.object({
  category: z.enum([...CATEGORIES, 'Unknown']),
  secondaryCategories: z.array(z.enum(CATEGORIES)),
  urgency: z.enum(['High', 'Medium', 'Low']),
  sentiment: z.enum(SENTIMENTS),
  churnRisk: z.boolean(),
  confidence: z.number().min(0).max(1),
  confidenceNotes: z.array(z.string()),
  needsHumanReview: z.boolean(),
  routeTo: z.enum(TEAMS),
  escalation: z.object({
    required: z.boolean(),
    target: z.enum(ESCALATION_TARGETS).nullable(),
    notify: z.array(z.enum(ESCALATION_TARGETS)),
    reasons: z.array(z.string()),
  }),
  recommendedAction: z.string().min(1),
  signals: z.array(z.string()),
  reasoning: z.string(),
  source: z.enum(['ai', 'offline']),
  fallbackReason: z.string().nullable(),
})

/**
 * Confidence from 0 to 1, computed by the app (not reported by the model).
 */
export function scoreConfidence({ ai, keywordCats, rulesUrgency, rulesSentiment, secondaryCategories, category }) {
  const notes = []
  let score = ai.source === 'ai' ? 0.9 : 0.6
  if (ai.source === 'offline') notes.push('offline keyword fallback, AI not used')

  if (category === 'Unknown') {
    return { confidence: 0.2, notes: [...notes, 'no category could be determined'] }
  }

  if (ai.source === 'ai') {
    if (keywordCats.length > 0 && !keywordCats.includes(category)) {
      score -= 0.25
      notes.push('AI and keyword rules disagree on the category')
    }
    if (ai.urgency && URGENCY_RANK[ai.urgency] < URGENCY_RANK[rulesUrgency]) {
      score -= 0.1
      notes.push('AI rated urgency lower than the rules')
    }
    if (ai.sentiment && SENTIMENT_RANK[rulesSentiment] - SENTIMENT_RANK[ai.sentiment] >= 2) {
      score -= 0.1
      notes.push('AI read the tone as much calmer than the rules')
    }
  }

  if (secondaryCategories.length > 0) {
    score -= 0.1
    notes.push('message covers more than one topic')
  }

  const confidence = Math.round(Math.min(0.99, Math.max(0.05, score)) * 100) / 100
  return { confidence, notes }
}

/**
 * Triage one customer message.
 *
 * @param {string} message
 * @param {{ classify?: (message: string) => Promise<object> }} [options] - Inject the classifier (used by tests)
 * @returns {Promise<z.infer<typeof TriageResultSchema>>}
 */
export async function triageMessage(message, { classify = categorizeMessage } = {}) {
  const ai = await classify(message)
  const risk = assessRisk(message)
  const keywordCats = keywordCategories(message).map(k => k.category)

  const category = ai.category
  const secondaryCategories = [...new Set([...(ai.secondaryCategories || []), ...keywordCats])]
    .filter(c => c !== category && CATEGORIES.includes(c))

  // Sentiment: take the more concerning of the AI's and the rules' reading.
  const sentiment = ai.sentiment && SENTIMENT_RANK[ai.sentiment] > SENTIMENT_RANK[risk.sentiment]
    ? ai.sentiment
    : risk.sentiment
  const churnRisk = risk.churnRisk || ai.churnRisk === true

  // Urgency: impact rules are the floor, the AI may raise it, and risk raises it further.
  const rules = combineUrgency(message, ai.urgency)
  let urgency = rules.level
  const signals = [...rules.signals, ...risk.signals]
  if (sentiment === 'Hostile' && urgency !== 'High') {
    urgency = 'High'
    signals.push('hostile customer raises urgency')
  }
  if (churnRisk && urgency !== 'High') {
    urgency = sentiment === 'Negative' || sentiment === 'Hostile' ? 'High' : 'Medium'
    signals.push('churn risk raises urgency')
  }
  if (ai.churnRisk === true && !risk.churnRisk) signals.push('AI detected churn risk')

  const { confidence, notes } = scoreConfidence({
    ai, keywordCats, rulesUrgency: rules.level, rulesSentiment: risk.sentiment, secondaryCategories, category,
  })
  const needsHumanReview = confidence < REVIEW_THRESHOLD

  const result = {
    category,
    secondaryCategories,
    urgency,
    sentiment,
    churnRisk,
    confidence,
    confidenceNotes: notes,
    needsHumanReview,
    routeTo: getRouteTeam(category),
    escalation: getEscalation({ category, urgency, sentiment, churnRisk, managerRequested: risk.managerRequested, needsHumanReview }),
    recommendedAction: getRecommendedAction(category, urgency, { sentiment, churnRisk, secondaryCategories }),
    signals: [...new Set(signals)],
    reasoning: ai.reasoning,
    source: ai.source,
    fallbackReason: ai.fallbackReason ?? null,
  }

  // Final guard: never hand an off-schema result to the UI or history.
  return TriageResultSchema.parse(result)
}
