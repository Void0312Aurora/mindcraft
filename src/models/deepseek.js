import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';

export class DeepSeek {
    static prefix = 'deepseek';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params;

        let config = {};

        config.baseURL = url || 'https://api.deepseek.com';
        config.apiKey = getKey('DEEPSEEK_API_KEY');

        this.openai = new OpenAIApi(config);
        this.reasoningFor = new Map(); // reply text -> reasoning, consumed by takeReasoning
    }

    takeReasoning(reply) {
        const reasoning = this.reasoningFor.get(reply) ?? null;
        this.reasoningFor.delete(reply);
        return reasoning;
    }

    async sendRequest(turns, systemMessage, stop_seq='***') {
        let messages = [{'role': 'system', 'content': systemMessage}].concat(turns);

        messages = strictFormat(messages);

        const pack = {
            model: this.model_name || "deepseek-chat",
            messages,
            stop: stop_seq,
            ...(this.params || {})
        };

        let res = null;
        try {
            console.log('Awaiting deepseek api response...')
            // console.log('Messages:', messages);
            let completion = await this.openai.chat.completions.create(pack);
            if (completion.choices[0].finish_reason == 'length')
                throw new Error('Context length exceeded'); 
            console.log('Received.')
            res = completion.choices[0].message.content;
            // Thinking mode returns its reasoning separately. Keep it per request
            // (chat, coding and memory calls overlap on this object) so an empty or
            // odd reply can be explained afterwards.
            const reasoning = completion.choices[0].message.reasoning_content;
            if (reasoning && typeof res === 'string') {
                this.reasoningFor.set(res, reasoning);
                // Replies discarded before logging never get taken; keep only recent ones.
                if (this.reasoningFor.size > 16) this.reasoningFor.delete(this.reasoningFor.keys().next().value);
            }
        }
        catch (err) {
            if ((err.message == 'Context length exceeded' || err.code == 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq);
            } else {
                console.log(err);
                res = 'My brain disconnected, try again.';
            }
        }
        return res;
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by Deepseek.');
    }
}



