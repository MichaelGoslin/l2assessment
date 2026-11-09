/**
 * Recommendation Templates - Maps categories to recommended actions
 */

const actionTemplates = {
  "Billing Issue": "Route to the billing team. Check the customer's payment history and reply with the specific charge or payment status.",
  "Technical Problem": "Route to technical support. Ask for the steps to reproduce, any error message, and the browser or device used.",
  "General Inquiry": "Reply with the matching help-center article, or answer directly if no article covers it.",
  "Feature Request": "Thank the customer and log the request on the product feedback board for the product team.",
  "Positive Feedback": "Send a short thank-you reply and share the note with the team. No support action needed.",
  "Unknown": "Review manually and assign a category."
}

const highUrgencyActions = {
  "Billing Issue": "Escalate to the billing lead now. A failed or duplicate payment can block the customer's account.",
  "Technical Problem": "Page the on-call engineer and open an incident. Reply to the customer within 15 minutes with a status update.",
}

/**
 * Get recommended action for a given category
 *
 * @param {string} category - The message category
 * @param {string} urgency - The urgency level
 * @returns {string} - Recommended next step
 */
export function getRecommendedAction(category, urgency) {
  if (urgency === 'High') {
    return highUrgencyActions[category]
      || `Escalate: reply within 1 hour. ${actionTemplates[category] || actionTemplates.Unknown}`
  }
  return actionTemplates[category] || actionTemplates.Unknown
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
 * Determines if message should be escalated to a human lead
 *
 * @param {string} category - The message category
 * @param {string} urgency - The urgency level
 * @returns {boolean} - Whether to escalate
 */
export function shouldEscalate(category, urgency) {
  return urgency === 'High' || category === 'Unknown'
}
