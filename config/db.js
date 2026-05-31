// Centralized database connection manager controlling the shared Mongoose link and per-app Mongo clients.
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

class DatabaseManager {
  constructor() {
    this.connections = new Map();
    this.mainConnection = null;
    this.mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    this.tenantConnections = new Map();
  }

  async connectMain() {
    try {
      this.mainConnection = await mongoose.connect(this.mongoUri, {
        dbName: 'masterapi',
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });

      console.log('✅ Connected to main database');
      return this.mainConnection;
    } catch (error) {
      console.error('❌ Main database connection failed:', error);
      throw error;
    }
  }

  // Simplify tenant DB connections
  async getTenantConnection(databaseName) {
    if (!this.tenantConnections.has(databaseName)) {
      const conn = mongoose.createConnection(this.mongoUri, {
        dbName: databaseName,
        maxPoolSize: 10,
        minPoolSize: 2
      });
      this.tenantConnections.set(databaseName, conn);
    }
    return this.tenantConnections.get(databaseName);
  }

  // Add tenant database management
  async getTenantConnection(appId) {
    const dbName = `app_${appId}`;

    if (!this.tenantConnections.has(dbName)) {
      const client = new MongoClient(this.mongoUri);
      await client.connect();
      const db = client.db(dbName);
      this.tenantConnections.set(dbName, db);

      console.log(`✅ Connected to tenant database: ${dbName}`);
    }

    return this.tenantConnections.get(dbName);
  }

  async closeConnection(dbName) {
    if (this.connections.has(dbName)) {
      const client = this.connections.get(dbName);
      await client.close();
      this.connections.delete(dbName);
    }
  }

  async closeAllConnections() {
    for (const [dbName, client] of this.connections) {
      await client.close();
    }
    this.connections.clear();

    if (this.mainConnection) {
      await mongoose.disconnect();
    }
  }

  // Add connection health monitoring
  async healthCheck() {
    try {
      await this.mainConnection.db.admin().ping();
      return { status: 'healthy', connections: this.tenantConnections.size };
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }
}

// Create singleton instance
const dbManager = new DatabaseManager();

// Export connectDB for main connection
const connectDB = () => dbManager.connectMain();

// Export getDBConnection for app-specific databases
const getDBConnection = (dbName) => dbManager.getTenantConnection(dbName);
const getTenantConnection = (dbName) => dbManager.getTenantConnection(dbName);

module.exports = {
  connectDB,
  getDBConnection,
  getTenantConnection,
  dbManager
};