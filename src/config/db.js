import mongoose from 'mongoose';

// Allow model initialization to wait for startup's connection, with a bounded timeout.
mongoose.set('bufferTimeoutMS', 5000);

export async function connectDatabase(uri, { production = false } = {}) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, autoIndex: !production });
  console.info('MongoDB connected');
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
