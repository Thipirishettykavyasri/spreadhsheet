// ─────────────────────────────────────────────────────────────
//  LLM provider abstraction.
//
//  The app never talks to a model directly — it talks to a
//  `provider`. A provider is any object with:
//
//      complete({ system, user, history }) => Promise<{ text, provider }>
//
//  `text` is the raw model output. You are expected to extract and
//  validate JSON from it yourself: models wrap JSON in prose, in code
//  fences, or return something that is not JSON at all.
//
//  Two providers ship with the repo:
//    • mock  — deterministic, offline, answers the prompts listed in
//              fixtures/ai-eval/*.json. Used by graders. The default.
//    • http  — YOURS. Call any LLM API you like (Anthropic, OpenAI,
//              Gemini, Ollama, …) with plain fetch(). Read the endpoint,
//              key and model from the VITE_AI_* env vars (.env.example).
//
//  Do not hard-code a vendor anywhere else: everything outside this
//  file must behave identically with either provider.
// ─────────────────────────────────────────────────────────────
import { createMockProvider } from './mockProvider.js'

/**
 * @typedef {{ role: 'user' | 'assistant', content: string }} ChatTurn
 * @typedef {{ system: string, user: string, history?: ChatTurn[] }} CompletionRequest
 * @typedef {{ text: string, provider: string }} CompletionResponse
 * @typedef {{ name: string, complete: (req: CompletionRequest) => Promise<CompletionResponse> }} Provider
 */

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}

/** @returns {Provider} */
export function createHttpProvider(config = {}) {
    const endpoint = config.endpoint ?? env.VITE_AI_ENDPOINT
    const apiKey = config.apiKey ?? env.VITE_AI_API_KEY
    const model = config.model ?? env.VITE_AI_MODEL

    return {
        name: 'http',
        async complete(request) {
            if (!endpoint) {
                throw new Error('PROVIDER_ERROR: VITE_AI_ENDPOINT is not configured in .env.local')
            }

            const messages = []
            if (request.system) {
                messages.push({ role: 'system', content: request.system })
            }
            if (request.history && Array.isArray(request.history)) {
                for (const turn of request.history) {
                    messages.push({ role: turn.role, content: turn.content })
                }
            }
            if (request.user) {
                messages.push({ role: 'user', content: request.user })
            }

            const headers = {
                'Content-Type': 'application/json'
            }
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`
            }

            let response
            try {
                response = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        model: model || 'default',
                        messages,
                        temperature: 0
                    })
                })
            } catch (networkErr) {
                throw new Error(`PROVIDER_ERROR (Network failure): ${networkErr.message}`)
            }

            if (!response.ok) {
                const status = response.status
                let body = ''
                try {
                    body = await response.text()
                } catch {
                    body = response.statusText
                }

                if (status === 401 || status === 403) {
                    throw new Error(`PROVIDER_ERROR (Authentication error ${status}): Invalid or missing API key`)
                } else if (status === 429) {
                    throw new Error(`PROVIDER_ERROR (Rate limit exceeded ${status}): Too many requests`)
                } else {
                    throw new Error(`PROVIDER_ERROR (HTTP ${status}): ${body || response.statusText}`)
                }
            }

            const data = await response.json()
            const modelText = data?.choices?.[0]?.message?.content || data?.text || data?.content?.[0]?.text || ''
            return {
                text: modelText,
                provider: 'http'
            }
        },
    }
}

/**
 * Pick a provider from VITE_AI_PROVIDER. Unknown values fall back to mock
 * so the app always boots.
 * @returns {Provider}
 */
export function createProvider(kind = env.VITE_AI_PROVIDER || 'mock') {
    if (kind === 'http') return createHttpProvider()
    return createMockProvider()
}
