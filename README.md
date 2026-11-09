# Customer Inbox Triage App

## Overview

The Customer Inbox Triage app is a lightweight AI-powered tool that helps classify customer support messages and recommend actions. It uses Groq AI to categorize messages, applies rule-based urgency scoring, and suggests next steps based on predefined templates.

## Problem Statement

Support teams waste time manually reading and triaging customer messages. This tool provides an automated first pass at classification to help prioritize and route messages more efficiently.

## Tech Stack

- **Frontend**: React + Vite + Tailwind CSS
- **AI**: Groq API (Llama 3.3 70B - Free tier)
- **Runtime**: Browser-based (local development only)

## Setup Instructions

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Groq API key (FREE - get from https://console.groq.com)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd "L2 assessment"
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Groq API Key**
   
   Create a `.env.local` file in the root directory:
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` and add your Groq API key:
   ```
   VITE_GROQ_API_KEY=gsk_your-actual-key-here
   ```
   
   Get your FREE API key from: https://console.groq.com/keys
   
   **Why Groq?** Groq offers a generous free tier with fast inference and no credit card required!

4. **Run the application**
   ```bash
   npm run dev
   ```
   
   The app will be available at `http://localhost:5173`

## How It Works

1. **Paste Message**: User pastes a customer support message into the text area
2. **Analyze**: Click "Analyze Message" to process the input
3. **Classification**: The app runs three processes in parallel:
   - **Category Classification** (LLM): Uses Groq AI (Llama 3.3 70B) to categorize the message
   - **Urgency Scoring** (Rule-based): Applies simple rules to determine urgency
   - **Recommendation** (Template-based): Maps category to a recommended action
4. **Display Results**: Shows category, urgency tag, recommended action, and AI reasoning
5. **History**: All analyses are saved to localStorage and viewable in the History tab


## Example Test Messages

Try analyzing these messages to see how the triage system works:

### Example 1: Production Issue
```
Our production server is down
```

### Example 2: Customer Feedback
```
Hi there! I just wanted to say thank you for your amazing customer service. I've been using your product for three years now and I'm really happy with it. Keep up the great work!
```

### Example 3: Feature Request
```
I would love to see a dark mode option in the app. It would be much easier on my eyes during night time usage.
```

### Example 4: Payment Issue
```
I tried to update my payment method but the page keeps loading forever. Is this a known issue?
```

### Example 5: Billing Question
```
Can I upgrade my subscription to the pro plan?
```

### Example 6: Technical Support
```
The dashboard won't load when I try to access it. I've tried refreshing but it keeps timing out.
```

## Triage Accuracy Improvements

> **Assessment write-up:** see [ASSESSMENT.md](ASSESSMENT.md) for the full audit, the top 3 issues with root causes, the validated triage schema (sentiment, churn risk, confidence, escalation), and before/after test results. Run the tests with `npm test`.

Testing the original app with the sample messages showed that it ranked and routed messages wrongly in ways that would cost Relay AI customers:

| Message | Before | After |
|---|---|---|
| "Database connection lost" | Low | **High**, escalated (crash or lost connection) |
| "Server down now" | Low | **High**, escalated (service outage) |
| "URGENT: ALL CUSTOMERS LOCKED OUT" | Low | **High**, escalated |
| Long cheerful website compliment with many "!" | High | Low, Positive Feedback |
| "Could you add an export to CSV feature?" | Action: "check billing portal" | Action: log on the product feedback board |
| Any message with no API key set | App rendered a blank page | Works, using the offline fallback |

**Top 3 problem areas found**

1. **Urgency scoring rewarded the wrong things.** Short messages were marked Low, every "!" added urgency, ALL CAPS and "?" lowered it, and the time of day changed the result. Real outages came out Low while friendly feedback came out High.
2. **The AI classification was unreliable.** The prompt asked for free text at temperature 0.7, and the category was picked by checking whether words like "billing" appeared anywhere in the reply. There was no fixed category list, and with no key set the app crashed instead of using its fallback.
3. **Routing and escalation were wrong.** Feature requests got the billing-portal reply, high-urgency issues got the same reply as minor ones, and escalation was based only on message length over 100 characters.

**What changed**

- `src/utils/urgencyScorer.js`: urgency now comes from business impact signals (outage, crash, lockout, production impact, data loss, security, failed or duplicate payment, "urgent"), and every result lists the signals behind it. The AI may raise urgency, but it can never lower a detected outage or lockout.
- `src/utils/llmHelper.js`: a system prompt defines the categories and urgency levels, asks for JSON, and runs at temperature 0. The reply is validated, and anything outside the allowed categories becomes `Unknown` so a person reviews it. The Groq client is created only when a key exists, so the offline fallback works. Adds a `Positive Feedback` category.
- `src/utils/templates.js`: each category has its own action, there are dedicated actions for high-urgency billing and technical issues, and escalation triggers on High urgency or an `Unknown` category.
- `src/pages/AnalyzePage.jsx`: shows why the urgency was chosen, an **Escalate** badge, and whether the AI or the offline fallback produced the result.

**Known limits:** the keyword rules can misfire on wording like "please slow down the emails" (marked Medium). The AI path was verified for JSON parsing and validation with sample replies but not against a live Groq key in this change.

## Security Note

⚠️ **Warning**: This application exposes the Groq API key in the browser (using `dangerouslyAllowBrowser: true`). This is acceptable for local development only but should **NEVER** be done in production. In a real application, API calls should be made from a secure backend server.

## Why Groq?

- ✅ **Completely Free** - No credit card required
- ✅ **Fast Inference** - Groq's LPU technology is incredibly fast
- ✅ **Generous Limits** - ~14,400 requests/day on free tier
- ✅ **High Quality** - Llama 3.3 70B performs excellently
- ✅ **Easy Signup** - Get started in minutes at https://console.groq.com

## License

This project is for educational purposes only.
