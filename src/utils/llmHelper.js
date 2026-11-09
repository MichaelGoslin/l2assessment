import Groq from 'groq-sdk';

/**
 * LLM Helper for categorizing customer support messages
 * Using Groq API for AI-powered categorization
 */

export const CATEGORIES = [
  "Billing Issue",
  "Technical Problem",
  "Feature Request",
  "General Inquiry",
  "Positive Feedback",
];

const URGENCY_LEVELS = ["High", "Medium", "Low"];

const SYSTEM_PROMPT = `You triage customer support messages for a SaaS company.
Return ONLY a JSON object with these keys:
- "category": exactly one of ${CATEGORIES.map(c => `"${c}"`).join(", ")}
- "urgency": exactly one of "High", "Medium", "Low"
- "reasoning": one or two sentences explaining the category and urgency

Category definitions:
- Billing Issue: payments, charges, invoices, refunds, plan or subscription changes.
- Technical Problem: errors, bugs, outages, pages not loading, login or access problems.
- Feature Request: asking for new functionality or a change to how the product works.
- General Inquiry: questions about the product, company, or policies with no problem reported.
- Positive Feedback: praise or thanks with no request or problem.
If a message mixes billing and technical problems, pick the one that blocks the customer most.

Urgency is about business impact, not tone, length, or punctuation:
- High: outage, data loss, security concern, customer locked out, failed payment blocking access, many users affected.
- Medium: something is broken or wrong for one customer but they can keep working.
- Low: questions, feature requests, feedback, thanks.`;

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

/**
 * Parse and validate the model's JSON reply.
 * Anything outside the allowed categories becomes "Unknown" so it gets
 * reviewed by a person instead of being silently misrouted.
 *
 * @param {string} content - Raw model output
 * @returns {{category: string, urgency: string|null, reasoning: string}}
 */
export function parseCategorization(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model did not return JSON');
    data = JSON.parse(match[0]);
  }

  const category = CATEGORIES.find(c => c.toLowerCase() === String(data.category || '').trim().toLowerCase()) || "Unknown";
  const urgency = URGENCY_LEVELS.find(u => u.toLowerCase() === String(data.urgency || '').trim().toLowerCase()) || null;
  const reasoning = typeof data.reasoning === 'string' && data.reasoning.trim()
    ? data.reasoning.trim()
    : "No reasoning returned by the model.";

  return { category, urgency, reasoning };
}

/**
 * Categorize a customer support message using Groq AI
 *
 * @param {string} message - The customer support message
 * @returns {Promise<{category: string, urgency: string|null, reasoning: string, source: 'ai'|'offline'}>}
 */
export async function categorizeMessage(message) {
  const groq = getGroqClient();
  if (!groq) {
    return { ...getMockCategorization(message), urgency: null, source: 'offline' };
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

    return { ...parseCategorization(response.choices[0].message.content), source: 'ai' };
  } catch (error) {
    console.warn('Groq API failed, using offline categorization:', error.message);
    return { ...getMockCategorization(message), urgency: null, source: 'offline' };
  }
}

/**
 * Mock categorization for when API is unavailable
 */
function getMockCategorization(message) {
  const lowerMessage = message.toLowerCase();
  
  // Array of possible reasoning variations for each category
  const reasoningVariations = {
    billing: [
      "Based on keywords related to payments and billing, this appears to be a billing-related inquiry. The customer may need assistance with account charges or payment issues.",
      "This message contains billing terminology. The customer is likely experiencing issues with payments, invoices, or account charges.",
      "The message references financial matters related to the customer's account. This suggests a billing or payment concern that requires attention.",
    ],
    technical: [
      "This message describes technical difficulties or system errors. The customer is reporting functionality issues that may require engineering review.",
      "Based on error-related keywords, this appears to be a technical support issue. The customer is experiencing problems with product functionality.",
      "The message indicates a technical problem or bug. This requires investigation from the technical support team.",
      "System-related issues are mentioned in this message. The customer needs technical assistance to resolve functionality problems.",
    ],
    feature: [
      "This message suggests improvements or new functionality. The customer is providing product feedback and feature suggestions.",
      "The customer is requesting enhancements to the product. This appears to be a feature request that should be reviewed by the product team.",
      "Based on the language used, this seems to be a suggestion for product improvements rather than a support issue.",
    ],
    inquiry: [
      "This appears to be a general question about the product or service. The customer is seeking information or clarification.",
      "The message contains questions that don't indicate a specific problem. This is likely a general inquiry requiring informational support.",
      "Based on the question format, this seems to be an information request rather than a technical or billing issue.",
    ],
    positive: [
      "This message contains positive sentiment and appreciation. While not a support request, it may warrant acknowledgment.",
      "The customer is expressing satisfaction or gratitude. This doesn't appear to require immediate support action.",
    ],
    ambiguous: [
      "The message content is unclear or doesn't match standard support categories. Manual review may be needed for proper categorization.",
      "This message doesn't contain clear indicators for automatic categorization. Human review recommended.",
    ]
  };
  
  // Helper to get random reasoning
  const getRandomReasoning = (category) => {
    const reasons = reasoningVariations[category];
    return reasons[Math.floor(Math.random() * reasons.length)];
  };
  
  // Positive feedback with no problem in it
  const isPraise = ['thank', 'appreciate', 'great work', 'great job', 'love it', 'love your', 'positive feedback', 'keep up']
    .some(word => lowerMessage.includes(word));
  const mentionsProblem = ['but', 'however', 'error', 'issue', 'problem', 'broken', "can't", 'cannot', 'not working', 'down']
    .some(word => lowerMessage.includes(word));
  if (isPraise && !mentionsProblem) {
    return {
      category: "Positive Feedback",
      reasoning: getRandomReasoning('positive')
    };
  }

  // Billing-related detection
  if (lowerMessage.includes('bill') || lowerMessage.includes('payment') || 
      lowerMessage.includes('charge') || lowerMessage.includes('invoice') ||
      lowerMessage.includes('credit card') || lowerMessage.includes('subscription') ||
      lowerMessage.includes('refund') || lowerMessage.includes('cancel') && lowerMessage.includes('account')) {
    return {
      category: "Billing Issue",
      reasoning: getRandomReasoning('billing')
    };
  }
  
  // Technical problem detection
  if (lowerMessage.includes('bug') || lowerMessage.includes('error') || 
      lowerMessage.includes('broken') || lowerMessage.includes('not working') ||
      lowerMessage.includes('crash') || lowerMessage.includes('down') || 
      lowerMessage.includes('server') || lowerMessage.includes('loading') ||
      lowerMessage.includes('slow') || lowerMessage.includes('issue') ||
      lowerMessage.includes("won't load") || lowerMessage.includes('timing out') ||
      lowerMessage.includes("can't access") || lowerMessage.includes('locked out') ||
      lowerMessage.includes('connection lost') ||
      lowerMessage.includes('problem') && !lowerMessage.includes('no problem')) {
    return {
      category: "Technical Problem",
      reasoning: getRandomReasoning('technical')
    };
  }
  
  // Feature request detection
  if (lowerMessage.includes('feature') || lowerMessage.includes('add') && (lowerMessage.includes('please') || lowerMessage.includes('could')) ||
      lowerMessage.includes('improve') || lowerMessage.includes('would like to see') ||
      lowerMessage.includes('suggestion') || lowerMessage.includes('wish') ||
      lowerMessage.includes('could you') && lowerMessage.includes('add') ||
      lowerMessage.includes('enhancement') || lowerMessage.includes('would be great')) {
    return {
      category: "Feature Request",
      reasoning: getRandomReasoning('feature')
    };
  }
  
  // Question/inquiry detection
  if (lowerMessage.includes('how') || lowerMessage.includes('what') || 
      lowerMessage.includes('when') || lowerMessage.includes('where') ||
      lowerMessage.includes('can i') || lowerMessage.includes('is there') ||
      lowerMessage.includes('?')) {
    return {
      category: "General Inquiry",
      reasoning: getRandomReasoning('inquiry')
    };
  }
  
  // Fallback for ambiguous messages: send to a person instead of guessing
  return {
    category: "Unknown",
    reasoning: getRandomReasoning('ambiguous')
  };
}
