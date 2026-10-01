// OpenAI-compatible chat-completions brain.
//
// Single HTTP endpoint: POST {baseUrl}/chat/completions. Injectable
// fetchImpl (default: globalThis.fetch) so unit tests never touch the
// network. Error messages are passed through redact() before throwing so
// the API key (or any credential echoed by a server) never leaks.

import { redact } from '../core/redact.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAICompatibleBrain {
  constructor({ baseUrl, apiKey, model, fetchImpl } = {}) {
    const envBase = typeof process !== 'undefined' ? process.env.OPENAI_BASE_URL : undefined;
    this.baseUrl = String(baseUrl || envBase || DEFAULT_BASE_URL).replace(/\/+$/, '');

    const envKey = typeof process !== 'undefined' ? process.env.OPENAI_API_KEY : undefined;
    this.apiKey = apiKey || envKey;
    if (!this.apiKey) {
      throw new Error('OpenAICompatibleBrain: missing apiKey (pass apiKey or set OPENAI_API_KEY)');
    }

    const envModel = typeof process !== 'undefined' ? process.env.SWARM_MODEL : undefined;
    this.model = model || envModel || 'gpt-4o-mini';

    this.fetchImpl = fetchImpl || globalThis.fetch.bind(globalThis);
  }

  async complete(messages, opts = {}) {
    const body = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.json) {
      body.response_format = { type: 'json_object' };
    }

    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`OpenAICompatibleBrain: request failed: ${redact(err?.message ?? String(err))}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Redact the raw body first: redact() only deep-walks JSON-shaped
      // strings when the whole string is JSON, so prefixing before redact
      // would defeat sensitive-key scrubbing of JSON error bodies.
      throw new Error(`OpenAICompatibleBrain: HTTP ${res.status}: ${redact(text)}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  }
}
