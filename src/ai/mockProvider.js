// Deterministic offline provider. It "knows" exactly the prompts listed in
// fixtures/ai-eval/*.json and returns the canned action for each, wrapped
// the way real models tend to wrap JSON (prose, code fences) so that your
// response parsing is exercised. Any other prompt gets a `clarify` action.
//
// Graders run the whole eval set against this provider first, and only
// then against a live one. Do not edit the fixtures to make tests pass.
import queries from '../../fixtures/ai-eval/queries.json'
import formats from '../../fixtures/ai-eval/format-prompts.json'

const normalize = (s) => String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const TABLE = new Map()
for (const c of queries.cases) TABLE.set(normalize(c.prompt), c.plan)
for (const c of formats.cases) TABLE.set(normalize(c.prompt), c.action)

function wrap(action) {
    const json = JSON.stringify(action, null, 2)
    // Vary the wrapping so a parser that only handles one shape fails loudly.
    const shapes = [
        () => json,
        () => 'Here is the plan:\n\n```json\n' + json + '\n```\n\nLet me know if you want changes.',
        () => '```\n' + json + '\n```',
    ]
    return shapes[json.length % shapes.length]()
}

function lookupPlan(userText) {
    const n = normalize(userText)
    if (TABLE.has(n)) return TABLE.get(n)

    // User turns include sheet context plus the prompt. Prefer the longest
    // golden prompt contained in the message so wrapping does not miss.
    let bestKey = ''
    let bestPlan = null
    for (const [key, plan] of TABLE.entries()) {
        if (key && n.includes(key) && key.length >= bestKey.length) {
            bestKey = key
            bestPlan = plan
        }
    }
    return bestPlan
}

export function createMockProvider() {
    return {
        name: 'mock',
        async complete({ user }) {
            await new Promise(resolve => setTimeout(resolve, 150)) // pretend to be a network call
            const hit = lookupPlan(user)
            if (hit) return { text: wrap(hit), provider: 'mock' }
            return {
                text: wrap({
                    type: 'clarify',
                    question: 'The mock provider only knows the prompts listed in fixtures/ai-eval/. Set VITE_AI_PROVIDER=http and implement createHttpProvider() to ask anything else.',
                }),
                provider: 'mock',
            }
        },
    }
}
