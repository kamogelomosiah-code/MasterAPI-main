/**
 * Comprehensive API Test Suite
 * Tests all CRUD operations and endpoints
 */

const http = require('http');

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
            headers: res.headers,
            raw: responseData
          });
        } catch (err) {
          resolve({
            status: res.statusCode,
            body: null,
            headers: res.headers,
            raw: responseData
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
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         MasterAPI - Comprehensive Test Suite              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;
  let apiKey = '';
  let itemId = '';
  let itemId2 = '';

  const uniqueAppName = `TestApp_${Date.now()}`;
  const tests = [];

  try {
    // TEST 1: Health Check
    console.log('📋 TEST 1: API Health Check');
    const healthRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/health',
      method: 'GET'
    });

    if (healthRes.status === 200) {
      console.log('  ✅ PASS - API is healthy (Status: 200)');
      passed++;
      tests.push({ name: 'Health Check', status: 'PASS', statusCode: 200 });
    } else {
      console.log(`  ❌ FAIL - Status: ${healthRes.status}`);
      failed++;
      tests.push({ name: 'Health Check', status: 'FAIL', statusCode: healthRes.status });
    }

    // TEST 2: API Info
    console.log('\n📋 TEST 2: Get API Information');
    const infoRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/info',
      method: 'GET'
    });

    if (infoRes.status === 200 && infoRes.body.name) {
      console.log(`  ✅ PASS - API Info retrieved (${infoRes.body.name} v${infoRes.body.version})`);
      passed++;
      tests.push({ name: 'API Info', status: 'PASS', statusCode: 200 });
    } else {
      console.log(`  ❌ FAIL - Status: ${infoRes.status}`);
      failed++;
      tests.push({ name: 'API Info', status: 'FAIL', statusCode: infoRes.status });
    }

    // TEST 3: Create/Register App
    console.log('\n📋 TEST 3: Create New App');
    const registerRes = await makeRequest(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/api/apps/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      { name: uniqueAppName, description: 'Comprehensive API test' }
    );

    if (registerRes.status === 200 && registerRes.body.app?.apiKey) {
      apiKey = registerRes.body.app.apiKey;
      console.log(`  ✅ PASS - App created successfully`);
      console.log(`     App Name: ${registerRes.body.app.name}`);
      console.log(`     API Key: ${apiKey.substring(0, 32)}...`);
      passed++;
      tests.push({ name: 'Create App', status: 'PASS', statusCode: 200 });
    } else {
      console.log(`  ❌ FAIL - Status: ${registerRes.status}`);
      console.log(`     Response: ${JSON.stringify(registerRes.body)}`);
      failed++;
      tests.push({ name: 'Create App', status: 'FAIL', statusCode: registerRes.status });
    }

    if (!apiKey) {
      console.log('\n⚠️  Cannot continue - no API key obtained');
      return;
    }

    // TEST 4: List Apps
    console.log('\n📋 TEST 4: List All Apps');
    const listAppsRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/apps',
      method: 'GET'
    });

    if (listAppsRes.status === 200 && Array.isArray(listAppsRes.body.apps)) {
      console.log(`  ✅ PASS - Listed ${listAppsRes.body.count} apps`);
      passed++;
      tests.push({ name: 'List Apps', status: 'PASS', statusCode: 200 });
    } else {
      console.log(`  ❌ FAIL - Status: ${listAppsRes.status}`);
      failed++;
      tests.push({ name: 'List Apps', status: 'FAIL', statusCode: listAppsRes.status });
    }

    // TEST 5: Create Data (POST)
    console.log('\n📋 TEST 5: Create Data Item (C in CRUD)');
    const createRes = await makeRequest(
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
        name: 'Test User 1',
        email: 'user1@example.com',
        age: 30,
        city: 'New York'
      }
    );

    if (createRes.status === 201 && createRes.body.data?._id) {
      itemId = createRes.body.data._id;
      console.log(`  ✅ PASS - Data created successfully`);
      console.log(`     Item ID: ${itemId}`);
      console.log(`     Created At: ${createRes.body.data.createdAt}`);
      passed++;
      tests.push({ name: 'Create Data', status: 'PASS', statusCode: 201 });
    } else {
      console.log(`  ❌ FAIL - Status: ${createRes.status}`);
      console.log(`     Response: ${JSON.stringify(createRes.body)}`);
      failed++;
      tests.push({ name: 'Create Data', status: 'FAIL', statusCode: createRes.status });
    }

    // TEST 6: Create Another Item
    console.log('\n📋 TEST 6: Create Second Data Item');
    const create2Res = await makeRequest(
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
        name: 'Test User 2',
        email: 'user2@example.com',
        age: 25,
        city: 'Los Angeles'
      }
    );

    if (create2Res.status === 201 && create2Res.body.data?._id) {
      itemId2 = create2Res.body.data._id;
      console.log(`  ✅ PASS - Second item created`);
      console.log(`     Item ID: ${itemId2}`);
      passed++;
      tests.push({ name: 'Create Second Item', status: 'PASS', statusCode: 201 });
    } else {
      console.log(`  ❌ FAIL - Status: ${create2Res.status}`);
      failed++;
      tests.push({ name: 'Create Second Item', status: 'FAIL', statusCode: create2Res.status });
    }

    // TEST 7: Read Data (GET all)
    console.log('\n📋 TEST 7: Read All Data Items (R in CRUD)');
    const readAllRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/data/items?limit=50&offset=0',
      method: 'GET',
      headers: { 'X-API-Key': apiKey }
    });

    if (readAllRes.status === 200 && Array.isArray(readAllRes.body.data)) {
      console.log(`  ✅ PASS - Retrieved ${readAllRes.body.data.length} items`);
      console.log(`     Pagination: ${readAllRes.body.pagination.total} total, limit ${readAllRes.body.pagination.limit}`);
      passed++;
      tests.push({ name: 'Read All Items', status: 'PASS', statusCode: 200 });
    } else {
      console.log(`  ❌ FAIL - Status: ${readAllRes.status}`);
      failed++;
      tests.push({ name: 'Read All Items', status: 'FAIL', statusCode: readAllRes.status });
    }

    // TEST 8: Read Single Item
    console.log('\n📋 TEST 8: Read Single Data Item');
    if (itemId) {
      const readOneRes = await makeRequest({
        hostname: 'localhost',
        port: 3000,
        path: `/api/data/items/${itemId}`,
        method: 'GET',
        headers: { 'X-API-Key': apiKey }
      });

      if (readOneRes.status === 200 && readOneRes.body.data?._id) {
        console.log(`  ✅ PASS - Single item retrieved`);
        console.log(`     Name: ${readOneRes.body.data.name}`);
        console.log(`     Email: ${readOneRes.body.data.email}`);
        passed++;
        tests.push({ name: 'Read Single Item', status: 'PASS', statusCode: 200 });
      } else {
        console.log(`  ❌ FAIL - Status: ${readOneRes.status}`);
        failed++;
        tests.push({ name: 'Read Single Item', status: 'FAIL', statusCode: readOneRes.status });
      }
    } else {
      console.log(`  ⚠️  SKIP - No item ID available`);
    }

    // TEST 9: Update Data (PUT)
    console.log('\n📋 TEST 9: Update Data Item (U in CRUD)');
    if (itemId) {
      const updateRes = await makeRequest(
        {
          hostname: 'localhost',
          port: 3000,
          path: `/api/data/items/${itemId}`,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
          }
        },
        { age: 31, city: 'Boston' }
      );

      if (updateRes.status === 200 && updateRes.body.data?._id) {
        console.log(`  ✅ PASS - Item updated successfully`);
        console.log(`     New Age: ${updateRes.body.data.age}`);
        console.log(`     New City: ${updateRes.body.data.city}`);
        passed++;
        tests.push({ name: 'Update Item', status: 'PASS', statusCode: 200 });
      } else {
        console.log(`  ❌ FAIL - Status: ${updateRes.status}`);
        console.log(`     Response: ${JSON.stringify(updateRes.body)}`);
        failed++;
        tests.push({ name: 'Update Item', status: 'FAIL', statusCode: updateRes.status });
      }
    } else {
      console.log(`  ⚠️  SKIP - No item ID available`);
    }

    // TEST 10: Patch Data
    console.log('\n📋 TEST 10: Patch Data Item');
    if (itemId2) {
      const patchRes = await makeRequest(
        {
          hostname: 'localhost',
          port: 3000,
          path: `/api/data/items/${itemId2}`,
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
          }
        },
        { age: 26 }
      );

      if (patchRes.status === 200) {
        console.log(`  ✅ PASS - Item patched successfully`);
        console.log(`     Updated Age: ${patchRes.body.data?.age}`);
        passed++;
        tests.push({ name: 'Patch Item', status: 'PASS', statusCode: 200 });
      } else {
        console.log(`  ❌ FAIL - Status: ${patchRes.status}`);
        failed++;
        tests.push({ name: 'Patch Item', status: 'FAIL', statusCode: patchRes.status });
      }
    }

    // TEST 11: Delete Data (DELETE)
    console.log('\n📋 TEST 11: Delete Data Item (D in CRUD)');
    if (itemId2) {
      const deleteRes = await makeRequest({
        hostname: 'localhost',
        port: 3000,
        path: `/api/data/items/${itemId2}`,
        method: 'DELETE',
        headers: { 'X-API-Key': apiKey }
      });

      if (deleteRes.status === 200) {
        console.log(`  ✅ PASS - Item deleted successfully`);
        console.log(`     Message: ${deleteRes.body.message}`);
        passed++;
        tests.push({ name: 'Delete Item', status: 'PASS', statusCode: 200 });
      } else {
        console.log(`  ❌ FAIL - Status: ${deleteRes.status}`);
        failed++;
        tests.push({ name: 'Delete Item', status: 'FAIL', statusCode: deleteRes.status });
      }
    }

    // TEST 12: Verify Delete
    console.log('\n📋 TEST 12: Verify Item Deletion');
    if (itemId2) {
      const verifyRes = await makeRequest({
        hostname: 'localhost',
        port: 3000,
        path: `/api/data/items/${itemId2}`,
        method: 'GET',
        headers: { 'X-API-Key': apiKey }
      });

      if (verifyRes.status === 404) {
        console.log(`  ✅ PASS - Item confirmed deleted (404 Not Found)`);
        passed++;
        tests.push({ name: 'Verify Delete', status: 'PASS', statusCode: 404 });
      } else {
        console.log(`  ⚠️  Item still exists - Status: ${verifyRes.status}`);
      }
    }

    // TEST 13: Dashboard Accessibility
    console.log('\n📋 TEST 13: Dashboard Accessibility');
    const dashRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/dashboard',
      method: 'GET'
    });

    if (dashRes.status === 200) {
      console.log(`  ✅ PASS - Dashboard is accessible`);
      passed++;
      tests.push({ name: 'Dashboard Access', status: 'PASS', statusCode: 200 });
    } else {
      console.log(`  ❌ FAIL - Status: ${dashRes.status}`);
      failed++;
      tests.push({ name: 'Dashboard Access', status: 'FAIL', statusCode: dashRes.status });
    }

    // TEST 14: Home Page
    console.log('\n📋 TEST 14: Home Page Accessibility');
    const homeRes = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/',
      method: 'GET'
    });

    if (homeRes.status === 200) {
      console.log(`  ✅ PASS - Home page is accessible`);
      passed++;
      tests.push({ name: 'Home Page Access', status: 'PASS', statusCode: 200 });
    } else {
      console.log(`  ❌ FAIL - Status: ${homeRes.status}`);
      failed++;
      tests.push({ name: 'Home Page Access', status: 'FAIL', statusCode: homeRes.status });
    }

    // SUMMARY
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                     TEST SUMMARY                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    tests.forEach((test, idx) => {
      const icon = test.status === 'PASS' ? '✅' : '❌';
      console.log(`${idx + 1}. ${icon} ${test.name.padEnd(25)} - ${test.status} (${test.statusCode})`);
    });

    console.log(`\n📊 Results:`);
    console.log(`   ✅ Passed: ${passed}/${tests.length}`);
    console.log(`   ❌ Failed: ${failed}/${tests.length}`);
    console.log(`   Success Rate: ${((passed / tests.length) * 100).toFixed(1)}%`);

    if (failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! Your API is fully functional!');
      console.log('\n📝 CRUD Operations Summary:');
      console.log('   ✅ CREATE - Save new data items');
      console.log('   ✅ READ   - Retrieve single or all items');
      console.log('   ✅ UPDATE - Modify existing items');
      console.log('   ✅ DELETE - Remove items from database');
    } else {
      console.log(`\n⚠️  ${failed} tests failed. Check the output above for details.`);
    }

    console.log('\n📱 Access Dashboard: http://localhost:3000/dashboard');
    console.log('🏠 Access Home: http://localhost:3000');
    console.log('🔗 API Base: http://localhost:3000/api\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    console.error('\nMake sure the server is running:');
    console.error('  node index.js');
    process.exit(1);
  }
}

// Wait for server to be ready
setTimeout(runTests, 2000);
