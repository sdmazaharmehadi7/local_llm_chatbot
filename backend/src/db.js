/**
 * MongoDB Connection Helper
 *
 * Connects to MongoDB via Mongoose using MONGODB_URI.
 */

import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/ai_chat";

export async function connectDB() {
  const uri = process.env.MONGODB_URI || DEFAULT_URI;

  try {
    const conn = await mongoose.connect(uri);
    console.log(`[db] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (err) {
    console.error(`[db] MongoDB connection error:`, err.message);
    throw err;
  }
}

export default mongoose;
