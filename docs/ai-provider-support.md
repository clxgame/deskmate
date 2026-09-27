# AI provider connections and usage

Yume discovers models from the configured provider's model-list endpoint. A successful connection lists only returned chat-capable models when the endpoint provides capability metadata. A model-list response alone does not prove that every returned ID is callable with the current key. To require an actual call per model, or when the provider has no usable model-list endpoint, enter up to 12 comma-separated model IDs in the optional field. Verification then sends a short paid inference request to each ID and adds the set only if all calls succeed. This manual path currently requires an OpenAI-compatible chat endpoint. A model can still fail later because of changed permissions, quotas, or provider-specific features.

| Provider / model family | Example Base URL | Request adapter | Account usage in Yume |
| --- | --- | --- | --- |
| OpenAI GPT / o-series | `https://api.openai.com/v1` | Native OpenAI | Yume local tokens and requests |
| Anthropic Claude | `https://api.anthropic.com/v1` | Native Anthropic | Yume local tokens and requests |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | Native Google | Yume local tokens and requests |
| Cohere Command | `https://api.cohere.com/v2` | Native Cohere; models discovered at `/v1/models` | Yume local tokens and requests |
| DeepSeek | `https://api.deepseek.com` | OpenAI compatible | Official balance plus Yume local tokens and requests |
| Moonshot Kimi | `https://api.moonshot.ai/v1` | OpenAI compatible | Yume local tokens and requests |
| Zhipu GLM | `https://open.bigmodel.cn/api/paas/v4` | OpenAI compatible | Yume local tokens and requests |
| Alibaba Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI compatible | Yume local tokens and requests |
| ByteDance Doubao | `https://ark.cn-beijing.volces.com/api/v3` | OpenAI compatible | Yume local tokens and requests |
| xAI Grok | `https://api.x.ai/v1` | OpenAI compatible | Yume local tokens and requests |
| Mistral | `https://api.mistral.ai/v1` | OpenAI compatible | Yume local tokens and requests |
| OpenRouter (many model families) | `https://openrouter.ai/api/v1` | OpenAI compatible | Official current-key limit and daily spend plus Yume local tokens and requests |
| MiniMax, Meta Llama, Perplexity Sonar, Amazon Nova and other hosted families | An OpenAI-compatible gateway that exposes them | OpenAI compatible | Yume local tokens and requests, or the gateway-specific account card above |
| Other OpenAI-compatible gateways | Their documented API prefix | OpenAI compatible | Yume local tokens and requests |

Kuro gateway keeps its weekly balance card. The DeepSeek balance and OpenRouter key metrics are fetched from their official APIs. If an account query fails, the same card shows local Yume usage without presenting it as the provider's billed total. Local records cover completed Yume assistant messages only; earlier conversations and traffic from other clients are not included. A regular inference key is insufficient for some platforms' organization-wide billing APIs; those would require separate admin credentials and explicit integrations.

The current Yume chat and agent flow uses text-generation adapters. Model-list endpoints may also include image, audio, video, embedding, or special Responses-only models that this flow cannot run. Capability metadata is used when available, but providers without that metadata still require an inference check for each model. The app does not claim unconditional support for every model ID or every modality.
