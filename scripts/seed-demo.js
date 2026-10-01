import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Category } from '../src/models/Category.js';
import { Business } from '../src/models/Business.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

// Reuse demo records on subsequent runs without changing existing data.
async function findOrCreate(Model, filter, values) {
  return await Model.findOne(filter) ?? await Model.create({ ...filter, ...values });
}

const deadline = setTimeout(() => {
  console.error('Demo seed timed out. Check MongoDB connectivity.');
  process.exit(1);
}, 45000);

try {
  const config = parseEnv();
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: false,
    autoCreate: false,
  });

  // Development-only credentials. Set DEMO_SEED_PASSWORD in .env to override this value.
  const demoPassword = process.env.DEMO_SEED_PASSWORD || 'DemoPass123!';
  const passwordHash = await bcrypt.hash(demoPassword, 12);

  const owner = await findOrCreate(User, { email: 'demo.owner@example.com' }, {
    name: 'Demo Business Owner', role: 'business_owner', status: 'active',
  });
  const admin = await findOrCreate(User, { email: 'demo.admin@example.com' }, {
    name: 'Demo Admin', role: 'admin', status: 'active',
  });
  // Also update existing demo accounts, which may have been seeded before passwords existed.
  await User.updateMany(
    { _id: { $in: [owner._id, admin._id] } },
    { $set: { passwordHash } }
  );
  const category = await findOrCreate(Category, { slug: 'demo-cafes' }, {
    name: 'Demo Cafes', description: 'Sample category for testing the business directory.',
    isActive: true,
  });
  const business = await findOrCreate(Business, { slug: 'demo-corner-cafe' }, {
    name: 'Demo Corner Cafe',
    description: 'Fictional cafe for testing business listings.',
    owner: owner._id, category: category._id,
    email: 'demo.cafe@example.com',
    services: ['Coffee', 'Tea', 'Snacks'],
    address: { addressLine1: '123 Demo Street', city: 'Jaipur', state: 'Rajasthan', postalCode: '302001', country: 'IN' },
    workingHours: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => ({ day, opens: '09:00', closes: '18:00' })),
    listingStatus: 'published', verificationStatus: 'pending',
  });

  const savedBusiness = await Business.findById(business._id).populate('owner category');
  const savedAdmin = await User.findById(admin._id);
  if (!savedBusiness?.owner || !savedBusiness.category || savedAdmin?.role !== 'admin') {
    throw new Error('Demo record verification failed');
  }
  console.log(JSON.stringify({
    database: mongoose.connection.name,
    owner: { id: owner.id, email: owner.email, role: owner.role },
    admin: { id: savedAdmin.id, email: savedAdmin.email, role: savedAdmin.role },
    category: { id: category.id, name: category.name, collection: Category.collection.name },
    business: { id: business.id, name: business.name, collection: Business.collection.name },
    verified: true,
  }, null, 2));
} catch (error) {
  console.error('Demo seed failed:', error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[redacted URI]'));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
  clearTimeout(deadline);
}
