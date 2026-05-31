# MasterAPI

MasterAPI is a simple Node.js/Express REST API for managing app registrations, dynamic data storage, and AI-powered endpoints. It uses MongoDB for data persistence and supports modular expansion for new features.

## Project Structure & File Roles

### Entry Point
- **index.js**: Main server file. Sets up Express, connects to MongoDB, loads middleware and routes, serves the frontend, and handles errors.

### Configuration
- **config/database.config.js**: Handles MongoDB connection logic. Exports functions to connect and retrieve the database instance.

### Middleware
- **middleware/auth.middleware.js**: Implements API key authentication and basic rate limiting for protected endpoints.

### Models
- **models/app.model.js**: Defines schema for registered apps, API keys, and rate limits.
- **models/database.model.js**: Defines schema for database metadata (name, collections, status).
- **models/collection.model.js**: Defines schema for collection metadata (fields, document count, status).
- **models/db-meta.model.js**: Stores dynamic schema definitions for user-created databases/collections.
- **models/item.model.js**: Example schema for a generic item (with a name field).
- **models/news-scraper.model.js**: Universal news scraping logic using axios and cheerio.

### Controllers
- **controllers/collection.controller.js**: Handles collection creation and quick CRUD operations.
- **controllers/database.controller.js**: Handles database creation, listing, details, and deletion.
- **controllers/task.controller.js**: Universal MongoDB operations (CRUD, aggregate, etc.) based on URI and query parameters.

### Routes
- **routes/apps.routes.js**: API routes for app registration, info, and API key management.
- **routes/dynamic-items.routes.js**: API routes for CRUD operations on app-specific collections.
- **routes/ai.routes.js**: Endpoints for AI chat and model listing via OpenRouter API.

### Public
- **public/index.ejs**: Frontend UI for interacting with the API (app registration, data management, etc.).
- **public/api.svg**: (Optional) API logo or graphic.

### Environment & Config
- **.env**: Stores environment variables (e.g., MONGODB_URI, PORT, API keys).
- **package.json**: Lists project dependencies, scripts, and metadata.
- **.gitignore**: Specifies files/folders to ignore in git (node_modules, .env).

## How It Works
1. **Startup**: `index.js` loads environment variables, connects to MongoDB, and starts the Express server.
2. **Routing**: Requests are routed to controllers via route files (apps, dynamic-items, ai).
3. **Authentication**: Protected endpoints use `auth.middleware.js` to check API keys and enforce rate limits.
4. **Controllers**: Controllers use models and the database config to interact with MongoDB for CRUD and other operations.
5. **Frontend**: The public folder provides a simple UI for users to interact with the API.
6. **AI Integration**: The AI route connects to OpenRouter for chat and model listing endpoints.

## Endpoints Overview
- `/api/apps/register` (POST): Register a new app.
- `/api/apps/me` (GET): Get info about the current app.
- `/api/data/:collection` (CRUD): Manage data in dynamic collections.
- `/api/ai/models` (GET): List available AI models.
- `/api/ai/chat` (POST): Chat with AI.
- `/api/ai/completion` (POST): Get AI completions.
- `/api/health` (GET): Health check.
- `/api/info` (GET): API info and endpoint listing.

## Setup
1. Clone the repo and run `npm install`.
2. Create a `.env` file with your MongoDB URI and any required API keys.
3. Start the server with `npm run dev` or `npm start`.
4. Access the frontend at `http://localhost:3000` and API at `http://localhost:3000/api`.

## Notes
- All main files follow clear naming conventions for maintainability.
- Update import paths in your code if you rename files.
- Extend models, controllers, and routes to add new features as needed.

---
Feel free to ask for more details or code samples for any part of the app!

# MasterAPI Documentation

MasterAPI is a full-stack API service that provides data storage, AI capabilities, and multi-tenant architecture for external applications.

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- MongoDB
- Hugging Face API token (for AI features)

### Installation
```bash
git clone <your-repo>
cd MasterAPI
npm install
```

### Configuration
Create `.env` file:
```env
MONGODB_URI=mongodb://localhost:27017/masterapi
PORT=3000
HF_TOKEN=your_huggingface_token
BRAND_NAME=MasterAPI
PAGE_TITLE=MasterAPI Dashboard
```

### Start Server
```bash
npm start
```

Access the dashboard: http://localhost:3000

## 🔑 Authentication

All API requests require authentication using API keys.

### 1. Register Your Application
```bash
curl -X POST http://localhost:3000/api/apps/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Awesome App",
    "description": "Application using MasterAPI"
  }'
```

**Response:**
```json
{
  "success": true,
  "app": {
    "id": "507f1f77bcf86cd799439011",
    "name": "My Awesome App",
    "apiKey": "a1b2c3d4e5f6...",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 2. Use API Key in Requests
Include the API key in headers or query parameters:

**Header:**
```bash
curl -X GET http://localhost:3000/api/data/users \
  -H "X-API-Key: your-api-key"
```

**Query Parameter:**
```bash
curl -X GET "http://localhost:3000/api/data/users?apiKey=your-api-key"
```

## 📊 Data Storage API

Store and manage your application data in isolated MongoDB collections.

### Create Data
```bash
curl -X POST http://localhost:3000/api/data/users \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "age": 30,
    "preferences": {
      "theme": "dark",
      "notifications": true
    }
  }'
```

### Read Data
**Get all documents:**
```bash
curl -X GET "http://localhost:3000/api/data/users?limit=10&offset=0" \
  -H "X-API-Key: your-api-key"
```

**Get specific document:**
```bash
curl -X GET http://localhost:3000/api/data/users/document-id \
  -H "X-API-Key: your-api-key"
```

### Update Data
**Full update (PUT):**
```bash
curl -X PUT http://localhost:3000/api/data/users/document-id \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Doe",
    "email": "jane@example.com",
    "age": 31
  }'
```

**Partial update (PATCH):**
```bash
curl -X PATCH http://localhost:3000/api/data/users/document-id \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "age": 32
  }'
```

### Delete Data
```bash
curl -X DELETE http://localhost:3000/api/data/users/document-id \
  -H "X-API-Key: your-api-key"
```

### Batch Operations
```bash
curl -X POST http://localhost:3000/api/data/users/batch \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {"name": "User 1", "email": "user1@example.com"},
      {"name": "User 2", "email": "user2@example.com"}
    ]
  }'
```

## 🤖 AI API

Use Hugging Face models for text generation, image creation, and speech synthesis.

### Available Models
```bash
curl -X GET http://localhost:3000/api/ai/models \
  -H "X-API-Key: your-api-key"
```

### Text Generation (Chat)
```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistralai/Mistral-7B-Instruct-v0.3",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Explain quantum computing in simple terms."}
    ]
  }'
```

### Image Generation
```bash
curl -X POST http://localhost:3000/api/ai/image \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset over mountains, digital art",
    "model": "black-forest-labs/FLUX.1-dev",
    "width": 1024,
    "height": 1024
  }'
```

### Text-to-Speech
```bash
curl -X POST http://localhost:3000/api/ai/speech \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello, this is a text to speech conversion.",
    "model": "hexgrad/Kokoro-82M",
    "voice": "default",
    "speed": 1.0
  }'
```

### Unified AI Completion
```bash
curl -X POST http://localhost:3000/api/ai/complete \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B",
    "prompt": "Write a short poem about technology",
    "task": "text" // Optional: auto-detects if not specified
  }'
```

### Batch AI Processing
```bash
curl -X POST http://localhost:3000/api/ai/batch \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "requests": [
      {
        "id": "1",
        "model": "mistralai/Mistral-7B-Instruct-v0.3",
        "input": "Explain AI in simple terms",
        "type": "text"
      },
      {
        "id": "2", 
        "model": "black-forest-labs/FLUX.1-dev",
        "input": "A robot painting a picture",
        "type": "image"
      }
    ]
  }'
```

## 🗄️ Database Management

Create and manage logical databases for your application.

### Create Database
```bash
curl -X POST http://localhost:3000/api/databases \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "myapp_production",
    "description": "Production database for MyApp"
  }'
```

### List Databases
```bash
curl -X GET http://localhost:3000/api/databases \
  -H "X-API-Key: your-api-key"
```

### Database Collections
**Create collection:**
```bash
curl -X POST http://localhost:3000/api/databases/myapp_production/collections \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "users",
    "description": "User profiles collection"
  }'
```

**List collections:**
```bash
curl -X GET http://localhost:3000/api/databases/myapp_production/collections \
  -H "X-API-Key: your-api-key"
```

## 📈 Monitoring & Health

### Health Check
```bash
curl -X GET http://localhost:3000/api/health
```

### API Info
```bash
curl -X GET http://localhost:3000/api/info
```

### Debug Routes
```bash
curl -X GET http://localhost:3000/api/debug/routes
```

## 🔒 Security Features

- **API Key Authentication**: Required for all operations
- **Rate Limiting**: 60 requests per minute per app
- **Data Isolation**: Each app has separate database
- **Audit Logging**: All requests are logged
- **Input Validation**: All inputs are validated

## 🚦 Rate Limits

- **Global**: 100 requests per 15 minutes per IP
- **Per App**: 60 requests per minute, 1000 per hour
- **AI Endpoints**: Additional limits based on Hugging Face quotas

## ❌ Error Handling

All errors follow this format:
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE" // Optional
}
```

### Common Error Codes
- `INVALID_API_KEY` - Authentication failed
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `VALIDATION_ERROR` - Invalid input data
- `NOT_FOUND` - Resource not found
- `DATABASE_ERROR` - Database operation failed

## 💡 Best Practices

### 1. Store API Keys Securely
```javascript
// Good: Store in environment variables
const API_KEY = process.env.MASTERAPI_KEY;

// Bad: Hardcode in source
const API_KEY = "a1b2c3d4e5f6";
```

### 2. Handle Errors Gracefully
```javascript
async function callMasterAPI() {
  try {
    const response = await fetch('/api/data/users', {
      headers: { 'X-API-Key': API_KEY }
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API call failed:', error.message);
    // Retry or show user-friendly message
  }
}
```

### 3. Use Pagination for Large Datasets
```javascript
async function getAllUsers() {
  let offset = 0;
  const limit = 50;
  const allUsers = [];
  
  while (true) {
    const response = await fetch(
      `/api/data/users?limit=${limit}&offset=${offset}`,
      { headers: { 'X-API-Key': API_KEY } }
    );
    
    const data = await response.json();
    allUsers.push(...data.data);
    
    if (data.data.length < limit) break;
    offset += limit;
  }
  
  return allUsers;
}
```

### 4. Cache Model Lists
```javascript
let cachedModels = null;

async function getModels() {
  if (!cachedModels) {
    const response = await fetch('/api/ai/models', {
      headers: { 'X-API-Key': API_KEY }
    });
    cachedModels = await response.json();
  }
  return cachedModels;
}
```

## 🔧 Integration Examples

### JavaScript/Node.js
```javascript
class MasterAPIClient {
  constructor(apiKey, baseURL = 'http://localhost:3000') {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }
  
  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    return await response.json();
  }
  
  async createData(collection, data) {
    return this.request(`/api/data/${collection}`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
  
  async generateText(prompt, model = 'default') {
    return this.request('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model
      })
    });
  }
}

// Usage
const client = new MasterAPIClient('your-api-key');
const result = await client.createData('users', { name: 'John' });
const aiResponse = await client.generateText('Hello AI!');
```

### Python
```python
import requests

class MasterAPIClient:
    def __init__(self, api_key, base_url="http://localhost:3000"):
        self.api_key = api_key
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({
            "X-API-Key": api_key,
            "Content-Type": "application/json"
        })
    
    def create_data(self, collection, data):
        response = self.session.post(
            f"{self.base_url}/api/data/{collection}",
            json=data
        )
        response.raise_for_status()
        return response.json()
    
    def generate_text(self, prompt, model="default"):
        response = self.session.post(
            f"{self.base_url}/api/ai/chat",
            json={
                "messages": [{"role": "user", "content": prompt}],
                "model": model
            }
        )
        response.raise_for_status()
        return response.json()

# Usage
client = MasterAPIClient("your-api-key")
result = client.create_data("users", {"name": "John"})
ai_response = client.generate_text("Hello AI!")
```

## 🆘 Troubleshooting

### Common Issues

**1. API Key Not Working**
- Check if the app is active: `GET /api/apps/me`
- Verify the key format (64-character hex)
- Ensure the key is included in headers or query params

**2. Rate Limit Errors**
- Implement exponential backoff in your client
- Reduce request frequency
- Contact support for higher limits if needed

**3. AI Model Not Responding**
- Check if Hugging Face token is valid
- Verify model name and availability
- Try a different model

**4. Database Connection Issues**
- Verify MongoDB is running
- Check connection string in .env file
- Ensure database user has proper permissions

### Getting Help
- Check the dashboard at http://localhost:3000
- Use the API tester in the dashboard
- View audit logs for request history
- Check server logs for detailed errors

## 📞 Support

For issues and questions:
1. Check this documentation
2. Use the API health endpoints
3. Review server logs
4. Contact support with your app ID and error details

---

**MasterAPI** - Your complete API platform for data storage and AI capabilities.