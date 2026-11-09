# Week 8 Technical Assessment: Customer Inbox Triage

Relay AI sells efficiency: support teams handle more volume without hiring. A triage tool only delivers that if it puts the right ticket in front of the right person first. The original app could not be trusted to do that, so this work makes triage **structured, validated, and risk-aware**.

## 1. Codebase audit

The app is a React + Vite single-page app with no backend. All triage runs in the browser:

| File | Role |
|---|---|
| `src/pages/AnalyzePage.jsx` | Takes a message, runs triage, shows results, saves history to `localStorage` |
| `src/utils/llmHelper.js` | Calls Groq (Llama 3.3 70B) for a category, with a keyword "mock" fallback |
| `src/utils/urgencyScorer.js` | Rule-based urgency score |
| `src/utils/templates.js` | Category → recommended action, plus an escalation check |
| `src/pages/HistoryPage.jsx`, `DashboardPage.jsx` | Read triage history from `localStorage` |

Answers to the audit questions (line numbers refer to the original code, commit `011d920`):

- **Determinism vs. hallucination:** there was no schema. The prompt (`llmHelper.js:27`) asked for free text at `temperature: 0.7` (`:30`). The category was then guessed by checking whether words like "billing" appeared anywhere in the reply (`:39-47`). A reply such as "this is not a billing issue, it's a bug" would still be classified as Billing.
- **Routing and priority rubric:** urgency was scored without any reference to impact. Each "!" added 30 points (`urgencyScorer.js:9`), short messages lost 40 to 100 points (`:11-12`), ALL CAPS lowered urgency (`:14`), a "?" lowered it (`:23`), and weekends or after-hours lowered it further (`:26-29`). There was no sentiment, no churn risk, and no target team.
- **Error handling and fallbacks:** the Groq client was built at import time (`llmHelper.js:9`), so with no key the whole app rendered a blank page and the documented fallback never ran. With a key, any reply was accepted. Nothing checked for empty output or unexpected fields.
- **Actionability and state:** history stored only category, urgency, action and the raw reply. There was no confidence score, no record of why a decision was made, and no escalation target.

## 2. Top 3 improvement areas

### Issue 1: AI output is unstructured and unvalidated
- **Root cause:** `llmHelper.js:22-31` (free-text prompt, temperature 0.7), `:39-47` (substring parsing), `:9` (client crashes without a key).
- **Business impact:** the same message can land in different queues on different runs, and any reply that mentions "billing" goes to the billing team. Misrouted tickets bounce between teams, which is exactly the wasted effort Relay AI promises to remove. Without a key, the product does not load at all.
- **Proposed solution:** a system prompt with defined categories, JSON output at temperature 0, and a Zod schema that validates every field in code. Off-list values become `Unknown` for human review. Invalid, empty, or failed replies fall back to deterministic keyword triage.

### Issue 2: Urgency ignores business impact, sentiment, and churn risk
- **Root cause:** `urgencyScorer.js:9-29` scores punctuation, length, capitals, and the clock. Nothing in the codebase detects anger or cancellation threats.
- **Business impact:** in testing, "Server down now" and "Database connection lost" were rated **Low**, while a cheerful compliment with several "!" was rated **High**. A customer threatening to cancel, or demanding a manager, got the FAQ-link reply. For a subscription business these are the most expensive tickets to miss: an outage multiplies across all of a customer's users, and a missed churn signal is lost recurring revenue.
- **Proposed solution:** deterministic impact signals (outage, lockout, data loss, security, failed payment), plus sentiment (Hostile / Negative / Neutral / Positive) and churn-risk detection. These rules act as a floor: the AI can raise urgency but can never lower it.

### Issue 3: Routing, escalation, and audit trail are missing or wrong
- **Root cause:** `templates.js:9` gives feature requests the billing-portal reply. `templates.js:20-21` ignores urgency entirely. `templates.js:42` escalates any message over 100 characters. `AnalyzePage.jsx:38` never passes urgency, and `:53` saves no reasoning or confidence.
- **Business impact:** agents get advice that doesn't match the ticket, real emergencies get the same reply as a typo report, and managers cannot audit why a decision was made or spot low-confidence results.
- **Proposed solution:** a team for every category, prioritized escalation targets (Support Manager, On-call Engineering, Customer Success, Billing Lead, Triage Lead), actions that adapt to urgency, sentiment, churn and secondary topics, and a full validated triage record saved to history.

## 3. Strategy and selected improvement

| Issue | Possible solutions | Effort | Impact |
|---|---|---|---|
| 1. Unstructured AI output | JSON mode + schema validation; function/tool calling; move the call to a backend | Low–Medium | High: every downstream step depends on a trustworthy category |
| 2. Wrong urgency, no risk signals | Deterministic impact rules; AI-assessed urgency; combine both with rules as the floor | Low | Very high: missed outages and churn threats cost the most |
| 3. Routing and audit | Team and escalation maps; confidence scoring; persistent audit records | Low | Medium–High |

**Selected improvement: a validated, risk-aware triage pipeline (`src/utils/triage.js`).** It combines the fixes for issues 1 and 2 into one place that every ticket passes through, and it produces the structured record issue 3 needs.

Why this matters most for Relay AI:
- **It removes the worst failure first.** Rating a production outage, a cancellation threat, or an angry customer as Low is the mistake that costs customers money and Relay AI renewals. Deterministic rules guarantee these are caught even if the AI is down or wrong.
- **It makes the AI safe to rely on.** Validation happens in code, not by hoping the model follows the prompt. Every reply is checked against a schema, and any failure falls back without losing the ticket.
- **It tells a manager when not to trust it.** A confidence score computed by the app (not reported by the model) drops when the AI and rules disagree or a message covers several topics, and low-confidence tickets go to human review instead of being auto-routed.
- **It scales.** Teams can trust automatic routing for most tickets and spend human attention only on the ones the system flags.

## 4. Implementation

| File | What it does |
|---|---|
| `src/utils/triage.js` (new) | Pipeline: AI or fallback → rules → combine → confidence → escalation → **`TriageResultSchema.parse`** before anything uses the result |
| `src/utils/riskSignals.js` (new) | Deterministic sentiment (Hostile / Negative / Neutral / Positive), churn risk, and manager or legal requests |
| `src/utils/llmHelper.js` | System prompt with defined categories, JSON mode, temperature 0, Zod-validated reply, multi-topic keyword detection, and a client that is only created when a key is set |
| `src/utils/urgencyScorer.js` | Impact-based urgency, with the signals that produced it |
| `src/utils/templates.js` | Team per category, prioritized escalation (primary target plus teams to notify), and context-aware actions |
| `src/pages/AnalyzePage.jsx` | Shows routing, escalation, sentiment, churn risk, confidence, signals, and the full validated JSON record |
| `tests/triage.test.js` (new) | 27 tests, run with `npm test` |

Output schema (enforced by Zod in `triage.js`):

```ts
{
  category: "Billing Issue" | "Technical Problem" | "Service Complaint" | "Feature Request"
          | "General Inquiry" | "Positive Feedback" | "Unknown",
  secondaryCategories: Category[],          // other topics in the same message
  urgency: "High" | "Medium" | "Low",
  sentiment: "Hostile" | "Negative" | "Neutral" | "Positive",
  churnRisk: boolean,
  confidence: number,                       // 0–1, computed by the app
  confidenceNotes: string[],                // why confidence was lowered
  needsHumanReview: boolean,                // confidence < 0.5
  routeTo: "Billing" | "Technical Support" | "Support Lead" | "Product" | "Support" | "Triage Lead",
  escalation: { required: boolean, target: Target | null, notify: Target[], reasons: string[] },
  recommendedAction: string,
  signals: string[],                        // rule and AI signals behind the decision
  reasoning: string,
  source: "ai" | "offline",
  fallbackReason: string | null
}
```

**How the AI and rules combine:**
- **Urgency:** the impact rules set a minimum. The AI can raise it. A hostile customer raises it to High. Churn risk raises it to at least Medium, or High if the customer is also upset.
- **Sentiment:** whichever of the AI's or the rules' reading is more concerning.
- **Churn risk:** true if either the AI or the rules detect it.
- **Confidence:** starts at 0.9 for an AI result or 0.6 for the offline fallback. It drops when the AI and keyword rules disagree on the category, when the AI rates urgency or tone lower than the rules, and when a message covers several topics. An `Unknown` category is fixed at 0.2.

## 5. Test scenarios: before and after

The results below are from the offline path (no Groq key was available), produced by the same code the app runs. The AI path is covered by the validation tests further down, using stubbed model replies.

| # | Scenario | Before | After |
|---|---|---|---|
| 1 | Billing dispute + cancellation threat | Billing, **Medium**, "check billing portal", escalated only because it is over 100 characters | Billing, **High**, churn risk, escalate to **Customer Success** and notify **Billing Lead** |
| 2 | Bug + feature request | Technical, **Low**, "restart their browser", feature request lost | Technical, **Medium**, secondary **Feature Request**, action covers both |
| 3 | Hostile, demands a manager | **General Inquiry**, Medium, "Respond with FAQ link" | **Service Complaint**, **High**, **Hostile**, escalate to **Support Manager** |
| 4 | Routine FAQ | General Inquiry, Low, FAQ link | General Inquiry, Low, Neutral, no escalation |
| 5 | Outage + churn risk | Technical, **Medium**, "restart their browser" | Technical, **High**, churn risk, page **On-call Engineering** and notify **Customer Success** |

### Scenario 1: High-urgency billing dispute / cancellation threat
> This is the second month you've double charged my card. Refund it today or I'm cancelling and moving to Zendesk.

```json
{
  "category": "Billing Issue",
  "secondaryCategories": [],
  "urgency": "High",
  "sentiment": "Negative",
  "churnRisk": true,
  "confidence": 0.6,
  "confidenceNotes": [
    "offline keyword fallback, AI not used"
  ],
  "needsHumanReview": false,
  "routeTo": "Billing",
  "escalation": {
    "required": true,
    "target": "Customer Success (retention)",
    "notify": [
      "Billing Lead"
    ],
    "reasons": [
      "customer may cancel or leave",
      "high-impact billing problem"
    ]
  },
  "recommendedAction": "Escalate to the billing lead now. A failed or duplicate payment can block the customer's account. Loop in Customer Success today to address the cancellation risk before the customer leaves.",
  "signals": [
    "failed or duplicate payment",
    "cancellation threat",
    "switching to a competitor",
    "recurring problem"
  ],
  "reasoning": "Keyword match: Billing Issue (charged, refund).",
  "source": "offline",
  "fallbackReason": "No API key configured"
}
```

### Scenario 2: Ambiguous multi-topic (bug + feature request)
> The CSV export throws an error every time I click it. Also, could you add a PDF export option?

```json
{
  "category": "Technical Problem",
  "secondaryCategories": [
    "Feature Request"
  ],
  "urgency": "Medium",
  "sentiment": "Negative",
  "churnRisk": false,
  "confidence": 0.5,
  "confidenceNotes": [
    "offline keyword fallback, AI not used",
    "message covers more than one topic"
  ],
  "needsHumanReview": false,
  "routeTo": "Technical Support",
  "escalation": {
    "required": false,
    "target": null,
    "notify": [],
    "reasons": []
  },
  "recommendedAction": "Route to technical support. Ask for the steps to reproduce, any error message, and the browser or device used. Also log the feature request on the product feedback board.",
  "signals": [
    "error or bug",
    "recurring problem"
  ],
  "reasoning": "Keyword match: Technical Problem (throws, error); Feature Request (could you add).",
  "source": "offline",
  "fallbackReason": "No API key configured"
}
```

### Scenario 3: Hostile escalation needing a manager
> This is absolutely unacceptable. I've emailed three times with no answer. I want to speak to a manager NOW.

```json
{
  "category": "Service Complaint",
  "secondaryCategories": [],
  "urgency": "High",
  "sentiment": "Hostile",
  "churnRisk": false,
  "confidence": 0.6,
  "confidenceNotes": [
    "offline keyword fallback, AI not used"
  ],
  "needsHumanReview": false,
  "routeTo": "Support Lead",
  "escalation": {
    "required": true,
    "target": "Support Manager",
    "notify": [],
    "reasons": [
      "customer asked for a manager or threatened legal action",
      "high urgency"
    ]
  },
  "recommendedAction": "Hand to a support manager now, who should reply personally and acknowledge the frustration. Apologize for the delay, give a named owner and a reply time, then resolve the original request.",
  "signals": [
    "asks for a manager",
    "strong anger",
    "repeated unanswered contact",
    "hostile customer raises urgency"
  ],
  "reasoning": "Keyword match: Service Complaint (unacceptable, emailed three times, no answer, manager).",
  "source": "offline",
  "fallbackReason": "No API key configured"
}
```

### Scenario 4: Routine low-priority FAQ
> What are your support hours on weekends?

```json
{
  "category": "General Inquiry",
  "secondaryCategories": [],
  "urgency": "Low",
  "sentiment": "Neutral",
  "churnRisk": false,
  "confidence": 0.6,
  "confidenceNotes": [
    "offline keyword fallback, AI not used"
  ],
  "needsHumanReview": false,
  "routeTo": "Support",
  "escalation": {
    "required": false,
    "target": null,
    "notify": [],
    "reasons": []
  },
  "recommendedAction": "Reply with the matching help-center article, or answer directly if no article covers it.",
  "signals": [],
  "reasoning": "Keyword match: General Inquiry (question).",
  "source": "offline",
  "fallbackReason": "No API key configured"
}
```

### Scenario 5: Outage with churn risk
> Your app has been down all morning and my whole team can't work. If this happens again we're switching providers.

```json
{
  "category": "Technical Problem",
  "secondaryCategories": [],
  "urgency": "High",
  "sentiment": "Negative",
  "churnRisk": true,
  "confidence": 0.6,
  "confidenceNotes": [
    "offline keyword fallback, AI not used"
  ],
  "needsHumanReview": false,
  "routeTo": "Technical Support",
  "escalation": {
    "required": true,
    "target": "On-call Engineering",
    "notify": [
      "Customer Success (retention)"
    ],
    "reasons": [
      "high-impact technical problem",
      "customer may cancel or leave"
    ]
  },
  "recommendedAction": "Page the on-call engineer and open an incident. Reply to the customer within 15 minutes with a status update. Loop in Customer Success today to address the cancellation risk before the customer leaves.",
  "signals": [
    "service outage",
    "switching to a competitor",
    "recurring problem"
  ],
  "reasoning": "Keyword match: Technical Problem (down).",
  "source": "offline",
  "fallbackReason": "No API key configured"
}
```

### Automated tests (`npm test`): 27 passing

- **The 5 scenarios above.**
- **All 8 messages in `sample-messages.json`:** every "expected issue" listed there is fixed (for example, "Database connection lost" is now High and the long cheerful message is now Low).
- **AI validation, using stubbed model replies:** valid replies are normalized. Off-list categories become `Unknown` and go to human review. JSON wrapped in prose or code fences still parses. Malformed JSON, plain text, an empty reply, wrong field types, a missing category, and an API error all fall back to offline triage without losing the outage's High urgency. The AI cannot downgrade an outage. Disagreement between the AI and the rules lowers confidence. AI-detected churn risk is kept.
- **The schema:** every result passes `TriageResultSchema`, and the schema rejects an invalid record.

### Known limits
- Not yet run against a live Groq key. The AI path is verified with stubbed replies only.
- Keyword rules can misfire on unusual wording, for example "please slow down the emails" is rated Medium. In AI mode, a category disagreement with the rules lowers confidence, which sends unclear cases to review.
- The API key is still exposed in the browser, as in the original. A production version should move the AI call to a backend endpoint.

## 6. Verify, commit, and push

```bash
npm install
npm test
npm run build
npm run dev
```

```bash
git checkout -b triage-risk-and-schema
git add ASSESSMENT.md README.md package.json package-lock.json src tests
git commit -m "Add validated, risk-aware triage pipeline"
git push -u origin triage-risk-and-schema
```
