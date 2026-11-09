import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { triageMessage } from '../utils/triage'

const urgencyStyles = {
  High: 'bg-red-200 text-red-900',
  Medium: 'bg-yellow-200 text-yellow-900',
  Low: 'bg-green-200 text-green-900',
}

const sentimentStyles = {
  Hostile: 'bg-red-100 text-red-800',
  Negative: 'bg-orange-100 text-orange-800',
  Neutral: 'bg-gray-100 text-gray-800',
  Positive: 'bg-green-100 text-green-800',
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-600 mb-1">{label}</div>
      {children}
    </div>
  )
}

function AnalyzePage() {
  const [message, setMessage] = useState('')
  const [results, setResults] = useState(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Check for example message from home page
    const exampleMessage = localStorage.getItem('exampleMessage')
    if (exampleMessage) {
      setMessage(exampleMessage)
      localStorage.removeItem('exampleMessage')
    }
  }, [])

  const handleAnalyze = async () => {
    if (!message.trim()) {
      alert('Please enter a message to analyze')
      return
    }

    setIsLoading(true)
    setResults(null)

    try {
      const triage = await triageMessage(message)
      const analysisResult = { message, ...triage, timestamp: new Date().toISOString() }

      setResults(analysisResult)

      // Save the full validated triage record to history
      const history = JSON.parse(localStorage.getItem('triageHistory') || '[]')
      history.push(analysisResult)
      localStorage.setItem('triageHistory', JSON.stringify(history))
    } catch (error) {
      console.error('Error analyzing message:', error)
      alert('Error analyzing message. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClear = () => {
    setMessage('')
    setResults(null)
  }

  const { message: _message, timestamp: _timestamp, ...triageJson } = results || {}

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Analyze Customer Message</h1>
          <p className="text-gray-600 mb-6">
            Paste a customer support message below to automatically categorize and prioritize.
          </p>

          {/* Input Section */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Customer Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Paste customer message here..."
              className="w-full border border-gray-300 rounded-lg p-3 h-40 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isLoading}
            />
            <div className="text-sm text-gray-500 mt-1">
              {message.length} characters
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3">
            <button
              onClick={handleAnalyze}
              disabled={isLoading}
              className={`flex-1 py-3 rounded-lg font-semibold ${
                isLoading
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Analyzing...
                </span>
              ) : (
                'Analyze Message'
              )}
            </button>
            <button
              onClick={handleClear}
              disabled={isLoading}
              className="px-6 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Results Section */}
        {results && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Analysis Results</h2>

            {results.escalation.required && (
              <div className="mb-4 bg-red-50 border border-red-300 rounded-lg p-4">
                <div className="font-semibold text-red-900">
                  Escalate to {results.escalation.target}
                  {results.escalation.notify.length > 0 && ` (also notify ${results.escalation.notify.join(', ')})`}
                </div>
                <div className="text-sm text-red-800 mt-1">Why: {results.escalation.reasons.join('; ')}</div>
              </div>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Category">
                  <div className="inline-block bg-blue-100 text-blue-800 px-4 py-2 rounded-lg font-semibold">
                    {results.category}
                  </div>
                  {results.secondaryCategories.length > 0 && (
                    <p className="text-sm text-gray-600 mt-2">Also mentions: {results.secondaryCategories.join(', ')}</p>
                  )}
                </Field>

                <Field label="Route to">
                  <div className="inline-block bg-indigo-100 text-indigo-800 px-4 py-2 rounded-lg font-semibold">
                    {results.routeTo}
                  </div>
                </Field>

                <Field label="Urgency Level">
                  <div className={`inline-block px-4 py-2 rounded-lg font-semibold ${urgencyStyles[results.urgency]}`}>
                    {results.urgency}
                  </div>
                </Field>

                <Field label="Customer Sentiment">
                  <div className={`inline-block px-4 py-2 rounded-lg font-semibold ${sentimentStyles[results.sentiment]}`}>
                    {results.sentiment}
                  </div>
                  {results.churnRisk && (
                    <span className="ml-3 inline-block bg-orange-600 text-white px-3 py-1 rounded-full text-sm font-semibold">
                      Churn risk
                    </span>
                  )}
                </Field>
              </div>

              <Field label="Signals detected">
                <p className="text-sm text-gray-700">
                  {results.signals.length ? results.signals.join(', ') : 'No outage, access, payment, error, anger, or churn signals found'}
                </p>
              </Field>

              <Field label="Confidence">
                <div className="flex items-center gap-3">
                  <div className="w-40 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${results.needsHumanReview ? 'bg-red-500' : results.confidence >= 0.8 ? 'bg-green-500' : 'bg-yellow-500'}`}
                      style={{ width: `${Math.round(results.confidence * 100)}%` }}
                    />
                  </div>
                  <span className="font-semibold text-gray-800">{Math.round(results.confidence * 100)}%</span>
                  {results.needsHumanReview && (
                    <span className="text-sm font-semibold text-red-700">Needs human review</span>
                  )}
                </div>
                {results.confidenceNotes.length > 0 && (
                  <p className="text-sm text-gray-600 mt-1">{results.confidenceNotes.join('; ')}</p>
                )}
              </Field>

              <Field label="Recommended Action">
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <p className="text-gray-800">{results.recommendedAction}</p>
                </div>
              </Field>

              <Field label={results.source === 'offline' ? `Reasoning (offline fallback: ${results.fallbackReason})` : 'AI Reasoning'}>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="prose prose-sm max-w-none text-gray-700">
                    <ReactMarkdown>
                      {results.reasoning}
                    </ReactMarkdown>
                  </div>
                </div>
              </Field>

              <details className="border border-gray-200 rounded-lg">
                <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-gray-700">
                  Triage record (validated JSON)
                </summary>
                <pre className="text-xs bg-gray-900 text-gray-100 p-4 overflow-x-auto rounded-b-lg">
                  {JSON.stringify(triageJson, null, 2)}
                </pre>
              </details>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(triageJson, null, 2))
                  alert('Triage record copied to clipboard!')
                }}
                className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 font-semibold"
              >
                📋 Copy Results
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AnalyzePage
