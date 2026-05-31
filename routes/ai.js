// AI proxy endpoints that front the Hugging Face service for models, chat, image, and audio tasks.
const express = require('express');
const router = express.Router();
const hfService = require('../services/huggingface');
const { authenticateApp } = require('../middleware/auth');

// Apply authentication to AI routes for usage tracking
router.use(authenticateApp);

// Enhanced model validation and provider detection
function detectModelProvider(modelId) {
    if (modelId.includes('huggingface.co') || modelId.includes('/')) {
        return 'huggingface';
    }
    if (modelId.includes('openai.com') || modelId.startsWith('gpt-')) {
        return 'openai';
    }
    if (modelId.includes('anthropic.com') || modelId.startsWith('claude-')) {
        return 'anthropic';
    }
    return 'huggingface'; // Default to Hugging Face
}

// Get available models
router.get('/models', async (req, res) => {
    try {
        const models = hfService.getAvailableModels();

        res.json({
            success: true,
            data: {
                text: Object.entries(models.text).map(([id, info]) => ({
                    id,
                    ...info
                })),
                image: Object.entries(models.image).map(([id, info]) => ({
                    id,
                    ...info
                })),
                audio: Object.entries(models.audio).map(([id, info]) => ({
                    id,
                    ...info
                }))
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch models',
            message: error.message
        });
    }
});

// Enhanced model info endpoint with provider detection
router.get('/models/:modelId', async (req, res) => {
    try {
        const { modelId } = req.params;
        const provider = detectModelProvider(modelId);

        const modelInfo = await hfService.getModelInfo(modelId, provider);

        if (!modelInfo) {
            return res.status(404).json({
                success: false,
                error: 'Model not found or provider not supported'
            });
        }

        res.json({
            success: true,
            data: {
                ...modelInfo,
                provider,
                supportedTasks: modelInfo.supportedTasks || ['text-generation']
            }
        });
    } catch (error) {
        console.error('Model info error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch model info',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Chat completion (text generation)
router.post('/chat', async (req, res) => {
    try {
        const {
            model = 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
            messages,
            provider,
            ...options
        } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({
                success: false,
                error: 'Messages array is required'
            });
        }

        // Validate messages structure
        for (const msg of messages) {
            if (!msg.role || !msg.content) {
                return res.status(400).json({
                    success: false,
                    error: 'Each message must have "role" and "content" properties'
                });
            }
        }

        const detectedProvider = provider || detectModelProvider(model);
        const result = await hfService.textGeneration(model, messages, options, detectedProvider);

        if (!result.success) {
            return res.status(result.statusCode || 500).json({
                success: false,
                error: result.error,
                provider: detectedProvider
            });
        }

        res.json({
            success: true,
            data: {
                ...result,
                model,
                provider: detectedProvider,
                usage: result.usage || { prompt_tokens: 0, completion_tokens: 0 }
            }
        });
    } catch (error) {
        console.error('Chat completion error:', error);
        res.status(500).json({
            success: false,
            error: 'Chat completion failed',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Enhanced image generation with format options
router.post('/image', async (req, res) => {
    try {
        const {
            model = 'black-forest-labs/FLUX.1-dev',
            prompt,
            format = 'base64', // base64, url, or blob
            width = 512,
            height = 512,
            ...options
        } = req.body;

        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Prompt is required for image generation'
            });
        }

        if (prompt.length > 1000) {
            return res.status(400).json({
                success: false,
                error: 'Prompt too long (max 1000 characters)'
            });
        }

        const result = await hfService.imageGeneration(model, prompt, {
            ...options,
            parameters: {
                ...options.parameters,
                width,
                height
            }
        });

        if (!result.success) {
            return res.status(result.statusCode || 500).json({
                success: false,
                error: result.error
            });
        }

        // Format response based on requested format
        let imageData = result.image;
        if (format === 'url' && result.image.startsWith('data:')) {
            // Convert base64 to URL (would need storage service)
            imageData = await hfService.storeImage(result.image);
        }

        res.json({
            success: true,
            data: {
                image: imageData,
                format,
                model,
                prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
                dimensions: { width, height }
            }
        });
    } catch (error) {
        console.error('Image generation error:', error);
        res.status(500).json({
            success: false,
            error: 'Image generation failed',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Enhanced text-to-speech with audio format options
router.post('/speech', async (req, res) => {
    try {
        const {
            model = 'hexgrad/Kokoro-82M',
            text,
            format = 'base64', // base64, url, or wav
            voice = 'default',
            speed = 1.0,
            ...options
        } = req.body;

        if (!text || typeof text !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Text is required for text-to-speech'
            });
        }

        if (text.length > 5000) {
            return res.status(400).json({
                success: false,
                error: 'Text too long (max 5000 characters)'
            });
        }

        const result = await hfService.textToSpeech(model, text, {
            ...options,
            parameters: {
                ...options.parameters,
                voice,
                speed
            }
        });

        if (!result.success) {
            return res.status(result.statusCode || 500).json({
                success: false,
                error: result.error
            });
        }

        res.json({
            success: true,
            data: {
                audio: result.audio,
                format,
                model,
                textLength: text.length,
                voice,
                speed
            }
        });
    } catch (error) {
        console.error('Text-to-speech error:', error);
        res.status(500).json({
            success: false,
            error: 'Text-to-speech failed',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Unified AI completion with task detection
router.post('/complete', async (req, res) => {
    try {
        const {
            model,
            messages,
            prompt,
            task, // Explicit task: text, image, audio
            ...options
        } = req.body;

        // Determine task type
        let detectedTask = task;
        if (!detectedTask) {
            if (prompt && !messages) {
                // Simple prompt for text generation
                detectedTask = 'text';
            } else if (model.includes('text') || model.includes('chat')) {
                detectedTask = 'text';
            } else if (model.includes('image') || model.includes('diffusion')) {
                detectedTask = 'image';
            } else if (model.includes('audio') || model.includes('speech') || model.includes('tts')) {
                detectedTask = 'audio';
            } else {
                detectedTask = 'text'; // Default to text
            }
        }

        let result;
        switch (detectedTask) {
            case 'text':
                const finalMessages = messages || [{ role: 'user', content: prompt }];
                result = await hfService.textGeneration(model, finalMessages, options);
                break;
            case 'image':
                if (!prompt) {
                    return res.status(400).json({
                        success: false,
                        error: 'Prompt is required for image generation'
                    });
                }
                result = await hfService.imageGeneration(model, prompt, options);
                break;
            case 'audio':
                if (!prompt && !text) {
                    return res.status(400).json({
                        success: false,
                        error: 'Text or prompt is required for audio generation'
                    });
                }
                result = await hfService.textToSpeech(model, prompt || text, options);
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: `Unsupported task: ${detectedTask}`
                });
        }

        if (!result.success) {
            return res.status(result.statusCode || 500).json({
                success: false,
                error: result.error,
                task: detectedTask
            });
        }

        res.json({
            success: true,
            data: {
                ...result,
                task: detectedTask,
                model: model || 'default',
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('AI completion error:', error);
        res.status(500).json({
            success: false,
            error: 'AI completion failed',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined,
            task: req.body.task
        });
    }
});

// New endpoint: Batch AI processing
router.post('/batch', async (req, res) => {
    try {
        const { requests } = req.body;

        if (!Array.isArray(requests) || requests.length > 10) {
            return res.status(400).json({
                success: false,
                error: 'Requests must be an array with max 10 items'
            });
        }

        const results = [];
        for (const request of requests) {
            try {
                const result = await hfService.unified(
                    request.model,
                    request.input,
                    request.type || 'text'
                );
                results.push({
                    success: true,
                    data: result,
                    requestId: request.id
                });
            } catch (error) {
                results.push({
                    success: false,
                    error: error.message,
                    requestId: request.id
                });
            }
        }

        res.json({
            success: true,
            data: {
                processed: results.length,
                results
            }
        });
    } catch (error) {
        console.error('Batch processing error:', error);
        res.status(500).json({
            success: false,
            error: 'Batch processing failed'
        });
    }
});

// Health check for AI services
router.get('/health', async (req, res) => {
    try {
        const health = await hfService.healthCheck();
        res.json({
            success: true,
            data: health
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            error: 'AI service unavailable'
        });
    }
});

module.exports = router;