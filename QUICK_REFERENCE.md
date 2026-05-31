# MasterAPI - Quick Reference

## 🚀 Start Server
```bash
node demo-server.js
```

## 🎨 Open Dashboard
Navigate to: http://localhost:3000/dashboard

---

## 📡 Core API Endpoints

### Register App
```
POST /api/apps/register
Body: { "name": "MyApp", "description": "..." }
Returns: { app: { id, name, apiKey, createdAt } }
```

### Save Data
```
POST /api/data/items
Header: X-API-Key: YOUR_API_KEY
Body: { "key": "value", ... }
Returns: { data: { _id, ...data, createdAt, updatedAt } }
```

### Get Data
```
GET /api/data/items?limit=50&offset=0
Header: X-API-Key: YOUR_API_KEY
Returns: { data: [...], pagination: { total, limit, offset } }
```

### Get Single Item
```
GET /api/data/items/:id
Header: X-API-Key: YOUR_API_KEY
Returns: { data: { ... } }
```

### Update Item
```
PUT /api/data/items/:id
Header: X-API-Key: YOUR_API_KEY
Body: { "key": "new_value", ... }
Returns: { data: { ... }, message: "..." }
```

### Delete Item
```
DELETE /api/data/items/:id
Header: X-API-Key: YOUR_API_KEY
Returns: { success: true, message: "..." }
```

---

## 💡 Examples

### Create App
```bash
curl -X POST http://localhost:3000/api/apps/register \
  -H "Content-Type: application/json" \
  -d '{"name":"TestApp"}'
```

### Save Item
```bash
curl -X POST http://localhost:3000/api/data/items \
  -H "X-API-Key: abc123..." \
  -H "Content-Type: application/json" \
  -d '{"name":"John","age":30}'
```

### List Items
```bash
curl -H "X-API-Key: abc123..." \
  http://localhost:3000/api/data/items
```

### Update Item
```bash
curl -X PUT http://localhost:3000/api/data/items/item-id \
  -H "X-API-Key: abc123..." \
  -H "Content-Type: application/json" \
  -d '{"age":31}'
```

### Delete Item
```bash
curl -X DELETE http://localhost:3000/api/data/items/item-id \
  -H "X-API-Key: abc123..."
```

---

## 📁 File Structure
```
project/
├── demo-server.js       ← Start here
├── start-demo.bat       ← Windows startup
├── public/
│   └── dashboard.html   ← Frontend UI
├── data/                ← Stored data
│   ├── apps.json
│   └── data.json
└── ...
```

---

## 🔐 Authentication
- All data endpoints require: `X-API-Key` header
- Get your API key from the dashboard
- Or use query param: `?apiKey=YOUR_KEY`

---

## 📊 Response Format
Success:
```json
{
  "success": true,
  "data": { ... },
  "message": "..."
}
```

Error:
```json
{
  "success": false,
  "error": "Error message here"
}
```

---

## ⚙️ Configuration
Edit `.env` file:
```
PORT=3000
BRAND_NAME=MasterAPI
PAGE_TITLE=MasterAPI Dashboard
```

---

## 🧪 Test Integration
```bash
node verify-app.js
```

---

## 📱 Frontend Usage
1. Go to http://localhost:3000/dashboard
2. Click "Register App"
3. Copy the API Key
4. Paste into "Add Data" form
5. Click "Save Data"
6. View in "Your Data Items"

---

**Need help?** See GETTING_STARTED.md for detailed docs.
