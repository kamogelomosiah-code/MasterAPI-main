// test-api.js
const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000/api';

async function testAPI() {
    try {
        console.log('🧪 Testing API connection...');

        // Test health endpoint
        const healthResponse = await axios.get(`${API_BASE_URL}/health`);
        console.log('✅ Health check:', healthResponse.data);

        // Test info endpoint
        const infoResponse = await axios.get(`${API_BASE_URL}/info`);
        console.log('✅ API Info:', infoResponse.data);

        // Test apps/register endpoint
        try {
            const registerResponse = await axios.post(`${API_BASE_URL}/apps/register`, {
                name: 'test-app-' + Date.now(),
                description: 'Test application'
            });
            console.log('✅ App registration:', registerResponse.data);
        } catch (registerError) {
            console.log('❌ App registration failed:', registerError.response?.data || registerError.message);
        }

    } catch (error) {
        console.log('❌ API connection failed:', error.message);
        console.log('Make sure your MasterAPI backend is running on port 3000');
    }
}

testAPI();