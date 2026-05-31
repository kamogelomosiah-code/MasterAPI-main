// test-api.js
// Script to test API routes

const axios = require('axios');

const BASE_URL = 'http://localhost:3000'; // Change if your server runs on a different port


// Will be set after registration
let apiKey = '';

const testRoutes = [
    // Registration
    {
        method: 'post',
        path: '/apps/register',
        description: 'Register new app',
        data: { name: 'TestApp' },
        auth: false,
        after: (res) => {
            if (res.data && res.data.app && res.data.app.apiKey) {
                apiKey = res.data.app.apiKey;
                console.log('API Key set:', apiKey);
            }
        }
    },
    // Apps
    { method: 'get', path: '/apps', description: 'Get all apps', auth: false },
    { method: 'get', path: '/apps/me', description: 'Get app by API key', auth: true },
    // Database
    { method: 'get', path: '/database/health', description: 'Database health', auth: false },
    { method: 'get', path: '/database/info', description: 'Database info', auth: false },
    // Data CRUD
    {
        method: 'post', path: '/data/testcollection', description: 'Create data in collection', auth: true, data: { foo: 'bar' }, after: (res) => {
            if (res.data && res.data.data && res.data.data.id) {
                testRoutes.find(r => r.description === 'Get specific item from collection').itemId = res.data.data.id;
                testRoutes.find(r => r.description === 'Update item in collection').itemId = res.data.data.id;
                testRoutes.find(r => r.description === 'Delete item from collection').itemId = res.data.data.id;
            }
        }
    },
    { method: 'get', path: '/data/testcollection', description: 'List data from collection', auth: true },
    { method: 'get', path: '/data/testcollection/:id', description: 'Get specific item from collection', auth: true, itemId: '', dynamic: true },
    { method: 'put', path: '/data/testcollection/:id', description: 'Update item in collection', auth: true, data: { foo: 'baz' }, dynamic: true, itemId: '' },
    { method: 'delete', path: '/data/testcollection/:id', description: 'Delete item from collection', auth: true, dynamic: true, itemId: '' },
    // HuggingFace AI
    { method: 'get', path: '/huggingface/models', description: 'Get available models', auth: true },
    { method: 'get', path: '/huggingface/models/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', description: 'Get specific model info', auth: true },
    { method: 'post', path: '/huggingface/chat', description: 'Chat completion', auth: true, data: { model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', messages: [{ role: 'user', content: 'Hello AI!' }] } },
    { method: 'post', path: '/huggingface/image', description: 'Image generation', auth: true, data: { model: 'stabilityai/stable-diffusion-xl-base-1.0', prompt: 'A cat in a spaceship' } },
    { method: 'post', path: '/huggingface/complete', description: 'Unified AI completion', auth: true, data: { model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', messages: [{ role: 'user', content: 'Tell me a joke.' }] } },
];


async function testRoute(route) {
    let url = BASE_URL + route.path;
    if (route.dynamic && route.itemId) {
        url = BASE_URL + route.path.replace(':id', route.itemId);
    }
    const headers = {};
    if (route.auth && apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    try {
        const response = await axios({
            method: route.method,
            url,
            headers,
            data: route.data || undefined,
        });
        console.log(`✅ ${route.description} [${route.method.toUpperCase()} ${url}]`);
        console.log('Status:', response.status);
        console.log('Response:', response.data);
        if (route.after) route.after(response);
    } catch (error) {
        if (error.response) {
            console.log(`❌ ${route.description} [${route.method.toUpperCase()} ${url}]`);
            console.log('Status:', error.response.status);
            console.log('Error:', error.response.data);
        } else {
            console.log(`❌ ${route.description} [${route.method.toUpperCase()} ${url}]`);
            console.log('Error:', error.message);
        }
    }
    console.log('-----------------------------');
}


async function runTests() {
    for (const route of testRoutes) {
        await testRoute(route);
    }
}

runTests();
