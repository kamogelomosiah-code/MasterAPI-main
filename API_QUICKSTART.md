# MasterAPI Quick Start Guide

Get up and running with MasterAPI in 5 minutes!

## Step 1: Get Your API Key

```bash
# Register your application
curl -X POST http://localhost:3000/api/apps/register \
  -H "Content-Type: application/json" \
  -d '{"name": "My Test App"}'

# Response will contain your API key
# {"success": true, "app": {"apiKey": "a1b2c3d4e5f6..."}}
```

## Step 2: Store Your First Data

```bash
# Create a user record
curl -X POST http://localhost:3000/api/data/users \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice Smith",
    "email": "alice@example.com",
    "age": 28
  }'
```

## Step 3: Retrieve Your Data

```bash
# Get all users
curl -X GET "http://localhost:3000/api/data/users" \
  -H "X-API-Key: YOUR_API_KEY"

# Get specific user by ID
curl -X GET "http://localhost:3000/api/data/users/DOCUMENT_ID" \
  -H "X-API-Key: YOUR_API_KEY"
```

## Step 4: Try AI Features

```bash
# Generate text with AI
curl -X POST http://localhost:3000/api/ai/chat \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Tell me a joke"}
    ]
  }'
```

## Step 5: Check Health

```bash
# Verify everything is working
curl -X GET http://localhost:3000/api/health
```

## Next Steps

1. **Explore the Dashboard**: Visit http://localhost:3000
2. **Read Full Documentation**: Check README.md for detailed API reference
3. **Integrate with Your App**: Use the code examples in your application
4. **Monitor Usage**: Check your app's usage statistics in the dashboard

## Example Integration Code

### JavaScript
```javascript
const API_KEY = 'your-api-key';

async function masterAPIRequest(endpoint, method = 'GET', data = null) {
  const response = await fetch(`http://localhost:3000/api/${endpoint}`, {
    method,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: data ? JSON.stringify(data) : null
  });
  
  return await response.json();
}

// Usage examples
const users = await masterAPIRequest('data/users');
const newUser = await masterAPIRequest('data/users', 'POST', {
  name: 'Bob Johnson',
  email: 'bob@example.com'
});
const aiResponse = await masterAPIRequest('ai/chat', 'POST', {
  messages: [{role: 'user', content: 'Hello AI!'}]
});
```

### Python
```python
import requests

API_KEY = 'your-api-key'
BASE_URL = 'http://localhost:3000/api'

def masterapi_request(endpoint, method='GET', data=None):
    headers = {'X-API-Key': API_KEY, 'Content-Type': 'application/json'}
    url = f"{BASE_URL}/{endpoint}"
    
    if method == 'GET':
        response = requests.get(url, headers=headers)
    else:
        response = requests.post(url, headers=headers, json=data)
    
    return response.json()

# Usage examples
users = masterapi_request('data/users')
new_user = masterapi_request('data/users', 'POST', {
    'name': 'Bob Johnson',
    'email': 'bob@example.com'
})
ai_response = masterapi_request('ai/chat', 'POST', {
    'messages': [{'role': 'user', 'content': 'Hello AI!'}]
})
```

## Need Help?

- Check the dashboard at http://localhost:3000
- Use the built-in API tester
- Review error responses for troubleshooting
- Check server logs for detailed information

Happy coding! 🚀
