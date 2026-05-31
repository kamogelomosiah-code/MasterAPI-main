/**
 * Simple test script to verify the app is working
 * Tests: Server startup, app registration, and data save/retrieval
 */

const http = require('http');
const { v4: uuidv4 } = require('uuid');

function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            body: responseData ? JSON.parse(responseData) : null,
            headers: res.headers
          });
        } catch (err) {
          resolve({
            status: res.statusCode,
            body: responseData,
            headers: res.headers
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function runTests() {
  console.log('🚀 MasterAPI Integration Test\n');
  
  const baseUrl = 'http://localhost:3000';
  let apiKey = '';
  let appId = '';
  const uniqueAppName = `TestApp_${Date.now()}`;

  try {
    // Test 1: Health Check
    console.log('Test 1: Checking API health...');
    const healthRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/health',
      method: 'GET'
    });
    
    if (healthRes.status === 200) {
      console.log('✓ API is healthy');
    } else {
      console.log('✗ Health check failed:', healthRes.status);
    }

    // Test 2: Register an app with unique name
    console.log('\nTest 2: Registering a new app...');
    const registerRes = await makeRequest(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/api/apps/register',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      },
      { name: uniqueAppName, description: 'Integration test app' }
    );

    if (registerRes.status === 200 && registerRes.body.app) {
      apiKey = registerRes.body.app.apiKey;
      appId = registerRes.body.app.id;
      console.log('✓ App registered successfully');
      console.log(`  App Name: ${uniqueAppName}`);
      console.log(`  API Key: ${apiKey.substring(0, 20)}...`);
    } else {
      console.log('✗ Failed to register app:', registerRes.status);
      console.log('  Response:', registerRes.body);
    }

    // Test 3: Save data
    console.log('\nTest 3: Saving test data...');
    const saveRes = await makeRequest(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/api/data/items',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        }
      },
      { 
        name: 'Test Item', 
        value: { message: 'Hello from test', timestamp: new Date().toISOString() },
        timestamp: new Date().toISOString()
      }
    );

    if (saveRes.status === 201) {
      console.log('✓ Data saved successfully');
    } else {
      console.log('✗ Failed to save data:', saveRes.status);
      console.log('  Response:', saveRes.body);
    }

    // Test 4: Retrieve data
    console.log('\nTest 4: Retrieving data...');
    const getRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/data/items?limit=10',
      method: 'GET',
      headers: {
        'X-API-Key': apiKey
      }
    });

    if (getRes.status === 200 && getRes.body.data) {
      console.log(`✓ Data retrieved successfully (${getRes.body.data.length} items)`);
    } else {
      console.log('✗ Failed to retrieve data:', getRes.status);
      console.log('  Response:', getRes.body);
    }

    // Test 5: Dashboard accessibility
    console.log('\nTest 5: Checking dashboard...');
    const dashRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/dashboard',
      method: 'GET'
    });

    if (dashRes.status === 200) {
      console.log('✓ Dashboard is accessible');
    } else {
      console.log('✗ Dashboard not found:', dashRes.status);
    }

    // Test 6: Home page
    console.log('\nTest 6: Checking home page...');
    const homeRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/',
      method: 'GET'
    });

    if (homeRes.status === 200) {
      console.log('✓ Home page is accessible');
    } else {
      console.log('✗ Home page not found:', homeRes.status);
    }

    console.log('\n✅ All tests completed!\n');
    console.log('📊 Dashboard: http://localhost:3000/dashboard');
    console.log('🏠 Home: http://localhost:3000');
    console.log('🔗 API Base: http://localhost:3000/api\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Test error:', error.message);
    console.error('\nMake sure the server is running on port 3000');
    console.error('Run: node demo-server.js');
    process.exit(1);
  }
}

// Wait a bit for server to be ready
setTimeout(runTests, 2000);
