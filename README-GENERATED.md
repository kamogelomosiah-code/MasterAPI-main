# MasterAPI

MasterAPI is a full-stack Node.js/Express REST API platform for app registration, dynamic data storage, and AI-powered endpoints. It features a modular, multi-tenant architecture, MongoDB persistence, and a built-in dashboard UI.

---

## 🚀 How It Works
1. **Startup**: `index.js` loads environment variables, connects to MongoDB, and starts the Express server.
2. **Routing**: Requests are routed to controllers via route files (apps, data, ai, databases).
3. **Authentication**: Protected endpoints use API key authentication and rate limiting (see `middleware/auth.js`).
4. **Controllers**: Controllers use models and config to interact with MongoDB for CRUD and other operations.
5. **Frontend**: The `views/index.ejs` file provides a dashboard UI for API testing, app registration, and data management.
6. **AI Integration**: The `/api/ai` routes connect to Hugging Face and OpenRouter for chat and completions.

---

## 📁 Project Structure
- **index.js**: Main server entry point
- **config/**: Database connection and environment config
- **controllers/**: Business logic for API endpoints
- **middleware/**: Auth, audit logging, error handling
- **models/**: MongoDB schemas for apps, databases, collections, audit logs
- **routes/**: API endpoint definitions
- **services/**: External integrations (AI, database, etc.)
- **utils/**: Utility functions
- **scripts/**: Build and maintenance scripts
- **views/**: EJS templates for the dashboard UI
- **public/**: Static assets (CSS, JS, images)

See `FOLDER_STRUCTURE.md` for a detailed breakdown.

---

## 🌐 Main Endpoints
- `POST /api/apps/register`: Register a new app
- `GET /api/apps/me`: Get info about the current app
- `CRUD /api/data/:collection`: Manage data in dynamic collections
- `GET /api/ai/models`: List available AI models
- `POST /api/ai/chat`: Chat with AI
- `POST /api/ai/completion`: Get AI completions
- `GET /api/health`: Health check
- `GET /api/info`: API info and endpoint listing

---

## 🛠️ Setup & Usage
1. Clone the repo and run `npm install`
2. Create a `.env` file with your MongoDB URI and any required API keys
3. Start the server with `npm run dev` or `npm start`
4. Access the dashboard at [http://localhost:3000](http://localhost:3000)

---

## 🔑 Authentication & Security
- All main endpoints require an API key (see `/api/apps/register`)
- Rate limiting: 60 requests/minute per app, 100/15min per IP
- Data isolation: Each app has a separate database
- Audit logging: All requests are logged
- Input validation and error handling are enforced

---

## 📊 Monitoring & Testing
- Health: `GET /api/health`
- API info: `GET /api/info`
- Debug routes: `GET /api/debug/routes`
- Automated tests: `node test-api.js` (see `test-api.js`)

---

## 🧩 Extending MasterAPI
- Add new models in `models/`
- Add business logic in `controllers/`
- Define new endpoints in `routes/`
- Integrate external services in `services/`

---

## 📚 Documentation
- See `README.md` (this file) for API reference and setup
- See `API_QUICKSTART.md` for a quick start guide
- See `FOLDER_STRUCTURE.md` for file and folder details

---

## 💡 Best Practices
- Use clear naming conventions (see `FOLDER_STRUCTURE.md`)
- Update import paths if you rename files
- Extend models, controllers, and routes to add features

---

## 🆘 Troubleshooting
- Check logs for errors
- Ensure `.env` is configured correctly
- Use the dashboard UI for manual API testing

---

## 📞 Support
Feel free to ask for more details or code samples for any part of the app!
