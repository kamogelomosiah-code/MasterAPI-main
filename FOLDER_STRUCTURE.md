# MasterAPI - Folder Structure Guide

## 📁 Root Directory
**Purpose**: Main application entry points and configuration files

### Files:
- `index.js` - Main Express server bootstrap
- `package.json` - Dependencies and scripts
- `.env` - Environment variables
- `.gitignore` - Git exclusion rules
- `README.md` - Main documentation
- `API_QUICKSTART.md` - Quick start guide

## 📁 config/
**Purpose**: Application configuration and database connection management

### Files:
- `db.js` - MongoDB connection manager and tenant database handling
- `environment.js` - Environment variable validation and defaults

## 📁 controllers/
**Purpose**: Business logic handlers for API endpoints

### Files:
- `appController.js` - Application registration and management
- `dataController.js` - CRUD operations for user data
- `databaseController.js` - Database lifecycle management
- `collectionController.js` - Collection operations
- `aiController.js` - AI service request handling

## 📁 middleware/
**Purpose**: Express middleware for request processing

### Files:
- `auth.js` - API key authentication and rate limiting
- `audit.js` - Request/response logging and auditing
- `errorHandler.js` - Unified error handling
- `validation.js` - Input validation middleware

## 📁 models/
**Purpose**: MongoDB schema definitions and data models

### Files:
- `app.js` - Registered applications schema
- `database.js` - Tenant database metadata
- `collection.js` - Collection metadata
- `auditLog.js` - Request audit trail
- `userData.js` - Generic user data storage

## 📁 routes/
**Purpose**: API endpoint definitions and routing

### Files:
- `appRoutes.js` - Application registration endpoints
- `dataRoutes.js` - Data CRUD operations
- `databaseRoutes.js` - Database management
- `aiRoutes.js` - AI service endpoints
- `healthRoutes.js` - Health check and monitoring

## 📁 services/
**Purpose**: External service integrations and API clients

### Files:
- `aiService.js` - Hugging Face and AI model integration
- `databaseService.js` - Database operations service
- `emailService.js` - Email notifications (future)
- `storageService.js` - File storage (future)

## 📁 utils/
**Purpose**: Utility functions and helpers

### Files:
- `documentProcessor.js` - PDF/text extraction utilities
- `validationUtils.js` - Data validation helpers
- `responseUtils.js` - Standardized API responses
- `securityUtils.js` - Security and encryption helpers

## 📁 scripts/
**Purpose**: Build tools and utility scripts

### Files:
- `bundleText.js` - Source code bundling for documentation
- `databaseMigration.js` - Database schema migrations
- `backup.js` - Data backup utilities

## 📁 views/
**Purpose**: Frontend EJS templates

### Files:
- `index.ejs` - Main dashboard interface
- `partials/` - Reusable template components
  - `header.ejs` - Page header
  - `sidebar.ejs` - Navigation sidebar
  - `footer.ejs` - Page footer

## 📁 public/
**Purpose**: Static assets served directly

### Files:
- `css/` - Stylesheets
  - `main.css` - Main application styles
- `js/` - Client-side JavaScript
  - `app.js` - Frontend application logic
- `images/` - Images and icons
  - `logo.svg` - Application logo

## 📁 docs/
**Purpose**: Documentation and guides

### Files:
- `apiReference.md` - Complete API documentation
- `deploymentGuide.md` - Production deployment instructions
- `troubleshooting.md` - Common issues and solutions
- `security.md` - Security best practices

## File Naming Convention
- **camelCase** for all JavaScript files: `dataController.js`
- **kebab-case** for HTML/CSS files: `main-page.html`
- **PascalCase** for class definitions in code
- **UPPERCASE** for constants in code

## Development Workflow

### Adding New Features:
1. **Model** → Define data schema in `models/`
2. **Controller** → Add business logic in `controllers/`
3. **Route** → Define endpoints in `routes/`
4. **Service** → Add external integrations in `services/`

### File Organization Principles:
- Single responsibility per file
- Related functionality grouped together
- Clear separation of concerns
- Consistent naming patterns
- Minimal file dependencies
