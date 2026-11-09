/**
 * Recommendation Templates - routing, escalation, and recommended actions
 */

const actionTemplates = {
  "Billing Issue": "Route to the billing team. Check the customer's payment history and reply with the specific charge or payment status.",
  "Technical Problem": "Route to technical support. Ask for the steps to reproduce, any error message, and the browser or device used.",
  "Service Complaint": "Apologize for the delay, give a named owner and a reply time, then resolve the original request.",
  "General Inquiry": "Reply with the matching help-center article, or answer directly if no article covers it.",
  "Feature Request": "Thank the customer and log the request on the product feedback board for the product team.",
  "Positive Feedback": "Send a short thank-you reply and share the note with the team. No support action needed.",
  "Unknown": "Review manually and assign a category."
}

const highUrgencyActions = {
  "Billing Issue": "Escalate to the billing lead now. A failed or duplicate payment can block the customer's account.",
  "Technical Problem": "Page the on-call engineer and open an incident. Reply to the customer within 15 minutes with a status update.",
}

// Short follow-ups for the other topics in a multi-topic message.
const secondaryNotes = {
  "Billing Issue": "check the billing question with the billing team",
  "Technical Problem": "open a ticket with technical support for the reported problem",
  "Service Complaint": "acknowledge the slow response",
  "Feature Request": "log the feature request on the product feedback board",
  "General Inquiry": "answer the customer's question",
  "Positive Feedback": "thank them for the kind words",
}

export const TEAMS = [
  "Billing",
  "Technical Support",
  "Support Lead",
  "Product",
  "Support",
  "Triage Lead",
]

const categoryTeams = {
  "Billing Issue": "Billing",
  "Technical Problem": "Technical Support",
  "Service Complaint": "Support Lead",
  "Feature Request": "Product",
  "General Inquiry": "Support",
  "Positive Feedback": "Support",
  "Unknown": "Triage Lead",
}

export const ESCALATION_TARGETS = [
  "Support Manager",
  "Customer Success (retention)",
  "On-call Engineering",
  "Billing Lead",
  "Triage Lead",
]

/**
 * Which team owns the ticket.
 *
 * @param {string} category
 * @returns {string}
 */
export function getRouteTeam(category) {
  return categoryTeams[category] || categoryTeams.Unknown
}

/**
 * Decide whether and to whom a ticket escalates. Rules are checked in
 * priority order: the first match is the primary target, any other
 * matched teams are notified, and every reason is listed.
 *
 * @param {{ category: string, urgency: string, sentiment: string, churnRisk: boolean, managerRequested: boolean, needsHumanReview: boolean }} t
 * @returns {{ required: boolean, target: string|null, notify: string[], reasons: string[] }}
 */
export function getEscalation(t) {
  const highTechnical = t.urgency === 'High' && t.category === 'Technical Problem'
  const highBilling = t.urgency === 'High' && t.category === 'Billing Issue'
  const rules = [
    { when: t.sentiment === 'Hostile' || t.managerRequested, target: 'Support Manager', reason: t.managerRequested ? 'customer asked for a manager or threatened legal action' : 'hostile customer' },
    { when: highTechnical, target: 'On-call Engineering', reason: 'high-impact technical problem' },
    { when: t.churnRisk, target: 'Customer Success (retention)', reason: 'customer may cancel or leave' },
    { when: highBilling, target: 'Billing Lead', reason: 'high-impact billing problem' },
    { when: t.urgency === 'High' && !highTechnical && !highBilling, target: 'Support Manager', reason: 'high urgency' },
    { when: t.needsHumanReview, target: 'Triage Lead', reason: 'low confidence in the automatic triage' },
  ].filter(r => r.when)

  const targets = [...new Set(rules.map(r => r.target))]
  return {
    required: rules.length > 0,
    target: targets[0] ?? null,
    notify: targets.slice(1),
    reasons: rules.map(r => r.reason),
  }
}

/**
 * Get recommended action for a given category
 *
 * @param {string} category - The message category
 * @param {string} urgency - The urgency level
 * @param {{ sentiment?: string, churnRisk?: boolean, secondaryCategories?: string[] }} [context]
 * @returns {string} - Recommended next step
 */
export function getRecommendedAction(category, urgency, context = {}) {
  const steps = []

  const hostile = context.sentiment === 'Hostile'
  if (hostile) {
    steps.push("Hand to a support manager now, who should reply personally and acknowledge the frustration.")
  }
  if (urgency === 'High' && !(hostile && !highUrgencyActions[category])) {
    steps.push(highUrgencyActions[category]
      || `Reply within 1 hour. ${actionTemplates[category] || actionTemplates.Unknown}`)
  } else {
    steps.push(actionTemplates[category] || actionTemplates.Unknown)
  }

  if (context.churnRisk) {
    steps.push("Loop in Customer Success today to address the cancellation risk before the customer leaves.")
  }

  const extras = (context.secondaryCategories || []).map(c => secondaryNotes[c]).filter(Boolean)
  if (extras.length > 0) {
    steps.push(`Also ${extras.join(' and ')}.`)
  }

  return steps.join(' ')
}

/**
 * Get all available categories
 *
 * @returns {string[]} - List of categories
 */
export function getAvailableCategories() {
  return Object.keys(actionTemplates)
}

/**
 * Backwards-compatible escalation check.
 *
 * @param {string} category - The message category
 * @param {string} urgency - The urgency level
 * @returns {boolean} - Whether to escalate
 */
export function shouldEscalate(category, urgency) {
  return urgency === 'High' || category === 'Unknown'
}
