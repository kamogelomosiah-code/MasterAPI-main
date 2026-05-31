# MasterAPI - Getting Started Guide

## ✅ What's Working

Your app is now fully functional with a **working frontend and API integration**. Here's what you can do:

### Features
- ✅ **Register Apps** - Create new apps and get API keys
- ✅ **Save Data** - Store JSON data using your API key
- ✅ **Retrieve Data** - Fetch your saved data back
- ✅ **Update Data** - Modify existing items
- ✅ **Delete Data** - Remove items from storage
- ✅ **File-based Storage** - Works without MongoDB (data persists in `/data` folder)
- ✅ **Beautiful Dashboard** - Modern, responsive UI

---

## 🚀 Quick Start

### Option 1: Run the Demo Server (Recommended - No MongoDB needed!)

```bash
node demo-server.js
```

The server will start on `http://localhost:3000`

### Option 2: Run with Full Express Setup (requires MongoDB)

```bash
node index.js
```

---

## 📊 Dashboard

Open your browser and go to: **http://localhost:3000/dashboard**

### Dashboard Features:
1. **Register New App** - Create an app and get your API key
2. **Add Data** - Save items to your personal storage
3. **View Data** - See all your saved items
4. **Delete Data** - Remove items individually
5. **API Status** - Check if the service is online

---

## 🔌 API Endpoints

### Apps
- `POST /api/apps/register` - Register a new app
- `GET /api/apps` - List all apps
- `GET /api/apps/me` - Get your app info (requires API key)

### Data
- `POST /api/data/items` - Save a new data item
- `GET /api/data/items` - Get all your data items
- `GET /api/data/items/:id` - Get a specific item
- `PUT /api/data/items/:id` - Update an item
- `DELETE /api/data/items/:id` - Delete an item

### Health
- `GET /api/health` - Check API status
- `GET /api/info` - Get API information

---

## 🔐 Authentication

Add the API key to your requests:

```bash
# Using Header
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/api/data/items

# Using Query Parameter
curl http://localhost:3000/api/data/items?apiKey=YOUR_API_KEY
```

---

## 💾 Data Storage

### Demo Server (File-based)
- Data is stored in the `/data` folder
- `apps.json` - Registered apps
- `data.json` - All saved data

### Full Server (MongoDB)
- Requires MongoDB running on `localhost:27017`
- Data is stored in MongoDB database

---

## 📝 Usage Examples

### 1. Register an App

```bash
curl -X POST http://localhost:3000/api/apps/register \
  -H "Content-Type: application/json" \
  -d '{"name": "My App", "description": "My first app"}'
```

Response:
```json
{
  "success": true,
  "app": {
    "id": "abc123",
    "name": "My App",
    "apiKey": "13184b2d7a8fa611dd7e...",
    "createdAt": "2024-01-01T10:00:00.000Z"
  }
}
```

### 2. Save Data

```bash
curl -X POST http://localhost:3000/api/data/items \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "name": "User 1",
    "email": "user@example.com",
    "age": 25
  }'
```

### 3. Get All Data

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  http://localhost:3000/api/data/items?limit=10&offset=0
```

### 4. Update Data

```bash
curl -X PUT http://localhost:3000/api/data/items/ITEM_ID \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"age": 26}'
```

### 5. Delete Data

```bash
curl -X DELETE http://localhost:3000/api/data/items/ITEM_ID \
  -H "X-API-Key: YOUR_API_KEY"
```

---

## 🛠️ Configuration

Create a `.env` file in the project root:

```env
# Server Port
PORT=3000

# MongoDB (optional, only for full server)
MONGODB_URI=mongodb://localhost:27017

# Branding
BRAND_NAME=MasterAPI
PAGE_TITLE=MasterAPI Dashboard
```

---

## 📁 Project Structure

```
MasterAPI/
├── demo-server.js          # ⭐ Run this for quick start
├── index.js                # Main Express server
├── package.json            # Dependencies
├── .env                    # Configuration
│
├── public/
│   ├── dashboard.html      # 🎨 Interactive frontend
│   └── ...
│
├── routes/
│   ├── apps.js             # App registration routes
│   ├── data.js             # Data CRUD routes
│   └── ...
│
├── models/
│   ├── App.js              # App schema
│   └── ...
│
├── config/
│   └── db.js               # Database configuration
│
├── middleware/
│   ├── auth.js             # API key authentication
│   └── ...
│
└── data/                   # 📦 File-based storage (demo)
    ├── apps.json
    └── data.json
```

---

## 🧪 Testing

Run the integration tests:

```bash
node verify-app.js
```

This will:
- Check API health
- Register a test app
- Save test data
- Retrieve the data
- Verify dashboard access

---

## 🐛 Troubleshooting

### Port already in use
If port 3000 is already in use:
```bash
# Change the port
PORT=3001 node demo-server.js
```

### MongoDB connection errors
Use the demo server instead (doesn't need MongoDB):
```bash
node demo-server.js
```

### CORS errors
The API has CORS enabled for all origins. If you still get errors, check that:
- Server is running
- API key is correct
- Headers are properly formatted

---

## 📚 Next Steps

1. **Explore the Dashboard** - http://localhost:3000/dashboard
2. **Register Your First App** - Click "Register New App"
3. **Save Some Data** - Use the "Add Data" form
4. **Check the API** - Try curl commands from "Usage Examples"
5. **Build Your Frontend** - Use the API endpoints in your app

---

## 🎯 Sample Use Cases

### Todo App
```bash
# Create a todo
curl -X POST http://localhost:3000/api/data/items \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Buy groceries", "completed": false}'
```

### User Database
```bash
# Save user
curl -X POST http://localhost:3000/api/data/items \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"username": "john_doe", "email": "john@example.com"}'
```

### Analytics
```bash
# Log event
curl -X POST http://localhost:3000/api/data/items \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"event": "page_view", "timestamp": "2024-01-01T10:00:00Z"}'
```

---

## 📞 Support

If something doesn't work:

1. Check the browser console (F12) for JavaScript errors
2. Check server logs in the terminal
3. Verify your API key is correct
4. Make sure the server is running on http://localhost:3000

---

## ✨ Key Features

- **No Setup Required** - Just run `node demo-server.js`
- **Data Persistence** - Data saves to disk automatically
- **REST API** - Standard HTTP methods (GET, POST, PUT, DELETE)
- **API Key Auth** - Secure your data with unique API keys
- **Beautiful UI** - Modern dashboard with Tabler icons
- **JSON Storage** - Store any JSON data you want
- **CORS Enabled** - Works with frontend apps on any domain

---

**Enjoy your MasterAPI! 🚀**
