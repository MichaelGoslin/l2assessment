import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { triageMessage, TriageResultSchema } from '../src/utils/triage.js'
import { categorizeMessage } from '../src/utils/llmHelper.js'

// Silence the expected fallback warnings.
console.warn = () => {}

// Offline classifier: same path the app takes when no API key is set.
const offline = (message) => categorizeMessage(message, { client: null })

// Fake Groq client that returns a fixed reply, to test the AI path.
const fakeClient = (content) => ({
  chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } },
})
const withAi = (content) => (message) => categorizeMessage(message, { client: fakeClient(content) })
const failingAi = (message) => categorizeMessage(message, {
  client: { chat: { completions: { create: async () => { throw new Error('rate limited') } } } },
})

describe('assessment scenarios', () => {
  test('1. billing dispute with a cancellation threat', async () => {
    const r = await triageMessage("This is the second month you've double charged my card. Refund it today or I'm cancelling and moving to Zendesk.", { classify: offline })
    assert.equal(r.category, 'Billing Issue')
    assert.equal(r.urgency, 'High')
    assert.equal(r.churnRisk, true)
    assert.equal(r.escalation.target, 'Customer Success (retention)')
    assert.ok(r.escalation.notify.includes('Billing Lead'))
  })

  test('2. bug report combined with a feature request', async () => {
    const r = await triageMessage('The CSV export throws an error every time I click it. Also, could you add a PDF export option?', { classify: offline })
    assert.equal(r.category, 'Technical Problem')
    assert.deepEqual(r.secondaryCategories, ['Feature Request'])
    assert.equal(r.urgency, 'Medium')
    assert.equal(r.routeTo, 'Technical Support')
    assert.match(r.recommendedAction, /feature request on the product feedback board/)
    assert.ok(r.confidence < 0.6, 'multi-topic lowers confidence')
  })

  test('3. hostile customer asking for a manager', async () => {
    const r = await triageMessage("This is absolutely unacceptable. I've emailed three times with no answer. I want to speak to a manager NOW.", { classify: offline })
    assert.equal(r.sentiment, 'Hostile')
    assert.equal(r.urgency, 'High')
    assert.equal(r.category, 'Service Complaint')
    assert.equal(r.escalation.target, 'Support Manager')
  })

  test('4. routine FAQ', async () => {
    const r = await triageMessage('What are your support hours on weekends?', { classify: offline })
    assert.equal(r.category, 'General Inquiry')
    assert.equal(r.urgency, 'Low')
    assert.equal(r.sentiment, 'Neutral')
    assert.equal(r.churnRisk, false)
    assert.equal(r.escalation.required, false)
  })

  test('5. outage with churn risk pages engineering first', async () => {
    const r = await triageMessage("Your app has been down all morning and my whole team can't work. If this happens again we're switching providers.", { classify: offline })
    assert.equal(r.urgency, 'High')
    assert.equal(r.churnRisk, true)
    assert.equal(r.escalation.target, 'On-call Engineering')
    assert.ok(r.escalation.notify.includes('Customer Success (retention)'))
  })
})

describe('sample-messages.json urgency', () => {
  const { testMessages } = JSON.parse(readFileSync(new URL('../sample-messages.json', import.meta.url)))
  const expected = { 1: 'High', 2: 'Low', 3: 'Low', 4: 'High', 5: 'Low', 6: 'High', 7: 'Low', 8: 'Low' }

  for (const t of testMessages) {
    test(`#${t.id} ${t.title}`, async () => {
      const r = await triageMessage(t.message, { classify: offline })
      assert.equal(r.urgency, expected[t.id])
    })
  }
})

describe('AI output validation and fallbacks', () => {
  const outage = 'Server down now'

  test('valid AI reply is used and normalized', async () => {
    const r = await triageMessage(outage, { classify: withAi('{"category":"technical problem","secondary_categories":[],"urgency":"high","sentiment":"negative","churn_risk":false,"reasoning":"Outage."}') })
    assert.equal(r.source, 'ai')
    assert.equal(r.category, 'Technical Problem')
    assert.equal(r.confidence, 0.9)
  })

  test('AI cannot downgrade an outage, and disagreement lowers confidence', async () => {
    const r = await triageMessage(outage, { classify: withAi('{"category":"Technical Problem","urgency":"Low","sentiment":"Neutral","churn_risk":false,"reasoning":"x"}') })
    assert.equal(r.urgency, 'High')
    assert.ok(r.confidence < 0.9)
    assert.ok(r.confidenceNotes.includes('AI rated urgency lower than the rules'))
  })

  test('AI category that contradicts the keywords lowers confidence', async () => {
    const r = await triageMessage('I was charged twice this month', { classify: withAi('{"category":"Feature Request","urgency":"Low","reasoning":"x"}') })
    assert.ok(r.confidenceNotes.includes('AI and keyword rules disagree on the category'))
    assert.equal(r.urgency, 'High')
  })

  test('off-list category becomes Unknown and goes to human review', async () => {
    const r = await triageMessage('hello there', { classify: withAi('{"category":"Spam","urgency":"Low","reasoning":"x"}') })
    assert.equal(r.category, 'Unknown')
    assert.equal(r.needsHumanReview, true)
    assert.equal(r.escalation.target, 'Triage Lead')
  })

  test('JSON wrapped in prose or code fences is still parsed', async () => {
    const r = await triageMessage(outage, { classify: withAi('Sure:\n```json\n{"category":"Technical Problem","urgency":"High","reasoning":"x"}\n```') })
    assert.equal(r.source, 'ai')
  })

  for (const [name, reply] of [
    ['malformed JSON', '{"category": "Billing Issue",'],
    ['plain text', 'This looks like a billing issue.'],
    ['empty reply', ''],
    ['wrong field types', '{"category": 42, "churn_risk": "yes"}'],
    ['missing category', '{"urgency":"High"}'],
  ]) {
    test(`${name} falls back to offline triage`, async () => {
      const r = await triageMessage(outage, { classify: withAi(reply) })
      assert.equal(r.source, 'offline')
      assert.equal(r.category, 'Technical Problem')
      assert.equal(r.urgency, 'High')
      assert.ok(r.fallbackReason)
    })
  }

  test('API error falls back to offline triage', async () => {
    const r = await triageMessage(outage, { classify: failingAi })
    assert.equal(r.source, 'offline')
    assert.match(r.fallbackReason, /rate limited/)
  })

  test('AI-detected churn risk is kept even without keywords', async () => {
    const r = await triageMessage('Honestly not sure this tool is worth it for us anymore.', { classify: withAi('{"category":"General Inquiry","urgency":"Low","sentiment":"Negative","churn_risk":true,"reasoning":"x"}') })
    assert.equal(r.churnRisk, true)
    assert.equal(r.urgency, 'High')
    assert.equal(r.escalation.target, 'Customer Success (retention)')
  })
})

describe('output schema', () => {
  test('every result matches TriageResultSchema', async () => {
    for (const m of ['hi', 'Thanks so much, great work!', 'Please add dark mode', 'Can I get a refund?', 'URGENT: ALL CUSTOMERS LOCKED OUT']) {
      const r = await triageMessage(m, { classify: offline })
      assert.doesNotThrow(() => TriageResultSchema.parse(r))
    }
  })

  test('the schema rejects an invalid record', () => {
    assert.throws(() => TriageResultSchema.parse({ category: 'Billing Issue', urgency: 'Critical' }))
  })
})
