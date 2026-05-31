// Wraps Hugging Face/OpenRouter clients and exposes unified helpers for text, image, and audio generation.
const { HfInference } = require('@huggingface/inference');
const axios = require('axios');

class AIService {
    constructor() {
        this.hf = new HfInference(process.env.HF_TOKEN);
        this.providers = {
            huggingface: this.hf,
            // Can add OpenAI, Anthropic, etc. here
        };
    }

    // Enhanced model registry with proper Hugging Face models
    getAvailableModels() {
        return {
            text: {
                'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B': {
                    name: 'DeepSeek R1 Distill',
                    description: 'Lightweight reasoning model',
                    provider: 'huggingface',
                    context: 4096,
                    supportedTasks: ['text-generation', 'chat']
                },
                'mistralai/Mistral-7B-Instruct-v0.3': {
                    name: 'Mistral 7B Instruct',
                    description: 'High-quality instruction following',
                    provider: 'huggingface',
                    context: 32768,
                    supportedTasks: ['text-generation', 'chat']
                },
                'meta-llama/Llama-2-7b-chat-hf': {
                    name: 'Llama 2 7B Chat',
                    description: 'Meta\'s conversational model',
                    provider: 'huggingface',
                    context: 4096,
                    supportedTasks: ['text-generation', 'chat']
                }
            },
            image: {
                'black-forest-labs/FLUX.1-dev': {
                    name: 'FLUX.1 Dev',
                    description: 'Advanced image generation',
                    provider: 'huggingface',
                    resolution: '1024x1024',
                    supportedTasks: ['text-to-image']
                },
                'stabilityai/stable-diffusion-xl-base-1.0': {
                    name: 'Stable Diffusion XL',
                    description: 'High-quality image generation',
                    provider: 'huggingface',
                    resolution: '1024x1024',
                    supportedTasks: ['text-to-image']
                }
            },
            audio: {
                'hexgrad/Kokoro-82M': {
                    name: 'Kokoro 82M',
                    description: 'Multilingual text-to-speech',
                    provider: 'huggingface',
                    languages: ['en', 'es', 'fr', 'de', 'it'],
                    supportedTasks: ['text-to-speech']
                },
                'microsoft/speecht5_tts': {
                    name: 'SpeechT5 TTS',
                    description: 'Microsoft text-to-speech',
                    provider: 'huggingface',
                    languages: ['en'],
                    supportedTasks: ['text-to-speech']
                }
            }
        };
    }

    async getModelInfo(modelId, provider = 'huggingface') {
        try {
            if (provider === 'huggingface') {
                // Try to get model info from Hugging Face API
                const response = await axios.get(
                    `https://huggingface.co/api/models/${modelId}`,
                    { timeout: 5000 }
                );

                return {
                    id: modelId,
                    name: response.data.modelId,
                    description: response.data.tags?.join(', ') || 'Hugging Face model',
                    provider: 'huggingface',
                    downloads: response.data.downloads,
                    likes: response.data.likes,
                    supportedTasks: response.data.tags || ['unknown']
                };
            }

            return null;
        } catch (error) {
            // Fallback to local registry
            const models = this.getAvailableModels();
            for (const category of Object.values(models)) {
                if (category[modelId]) {
                    return { id: modelId, ...category[modelId] };
                }
            }
            return null;
        }
    }

    async textGeneration(model, messages, options = {}, provider = 'huggingface') {
        try {
            if (provider === 'huggingface') {
                const response = await this.hf.chatCompletion({
                    model,
                    messages,
                    ...options
                });

                return {
                    success: true,
                    text: response.choices[0].message.content,
                    usage: {
                        prompt_tokens: response.usage?.prompt_tokens || 0,
                        completion_tokens: response.usage?.completion_tokens || 0,
                        total_tokens: response.usage?.total_tokens || 0
                    },
                    model: response.model
                };
            }

            throw new Error(`Provider ${provider} not supported for text generation`);
        } catch (error) {
            console.error('Text generation error:', error);
            return {
                success: false,
                error: error.message,
                statusCode: error.response?.status || 500
            };
        }
    }

    async imageGeneration(model, prompt, options = {}) {
        try {
            const response = await this.hf.textToImage({
                model,
                inputs: prompt,
                parameters: options.parameters || {}
            });

            // Convert blob to base64
            const arrayBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');

            return {
                success: true,
                image: `data:image/png;base64,${base64}`,
                model,
                prompt: prompt.substring(0, 50) + '...'
            };
        } catch (error) {
            console.error('Image generation error:', error);
            return {
                success: false,
                error: error.message,
                statusCode: error.response?.status || 500
            };
        }
    }

    async textToSpeech(model, text, options = {}) {
        try {
            const response = await this.hf.textToSpeech({
                model,
                inputs: text,
                parameters: options.parameters || {}
            });

            const arrayBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');

            return {
                success: true,
                audio: `data:audio/wav;base64,${base64}`,
                model,
                textLength: text.length
            };
        } catch (error) {
            console.error('Text-to-speech error:', error);
            return {
                success: false,
                error: error.message,
                statusCode: error.response?.status || 500
            };
        }
    }

    async healthCheck() {
        try {
            // Test Hugging Face API connectivity
            await this.hf.request({
                model: 'gpt2',
                inputs: 'test'
            }, { method: 'POST' });

            return {
                huggingface: 'healthy',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                huggingface: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = new AIService();