import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Category } from '../src/models/Category.js';
import { Business } from '../src/models/Business.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const photo = (id, width = 1200) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=80`;
const categoryRows = [
  ['cafes-restaurants', 'Cafes & Restaurants', ['Dining', 'Takeaway', 'Catering']],
  ['healthcare', 'Healthcare', ['Consultations', 'Diagnostics', 'Preventive care']],
  ['home-services', 'Home Services', ['Repairs', 'Installation', 'Maintenance']],
  ['beauty-wellness', 'Beauty & Wellness', ['Hair care', 'Skin care', 'Wellness']],
  ['education', 'Education', ['Classes', 'Training', 'Counselling']],
  ['automotive', 'Automotive', ['Repair', 'Maintenance', 'Inspection']],
  ['shopping', 'Shopping', ['Retail', 'Delivery', 'Consultation']],
  ['professional-services', 'Professional Services', ['Consultation', 'Advisory', 'Support']],
];

// Fictional listings for local development and screenshots. Most are in Lucknow and Noida.
const rows = [
  ['awadh-bean-house','Awadh Bean House','cafes-restaurants','Hazratganj','Lucknow','22 Mahatma Gandhi Marg','Near Hazratganj Metro','226001',[80.9462,26.8508],['Specialty coffee','Awadhi snacks','Brunch'],'moderate',2018,9,['photo-1509042239860-f550ce710b93','photo-1554118811-1e0d58224f24']],
  ['gomti-bake-studio','Gomti Bake Studio','cafes-restaurants','Gomti Nagar','Lucknow','5/21 Vibhuti Khand','Opposite Summit Building','226010',[81.0058,26.8652],['Custom cakes','Sourdough bread','Dessert boxes'],'moderate',2020,6,['photo-1509440159596-0249088772ff','photo-1486427944299-d1955d23e34d']],
  ['chowk-tandoor-kitchen','Chowk Tandoor Kitchen','cafes-restaurants','Chowk','Lucknow','18 Akbari Gate Road','By Gol Darwaza','226003',[80.9131,26.8673],['Mughlai cuisine','Family dining','Food delivery'],'moderate',2012,18,['photo-1517248135467-4c7edcad34c4','photo-1555396273-367ea4eb4db5']],
  ['indira-nagar-dental-care','Indira Nagar Dental Care','healthcare','Indira Nagar','Lucknow','B-Block, Faizabad Road','Near Bhootnath Market','226016',[80.9956,26.8841],['Dental check-ups','Root canal','Teeth whitening'],'moderate',2015,7,['photo-1606811971618-4486d14f3f99','photo-1629909613654-28e377c37b09']],
  ['aliganj-family-clinic','Aliganj Family Clinic','healthcare','Aliganj','Lucknow','Sector Q, Sitapur Road','Near Kendriya Bhawan','226024',[80.9434,26.9077],['General physician','Vaccinations','Health check-ups'],'budget',2011,5,['photo-1551076805-e1869033e561','photo-1576091160399-112ba8d25d1d']],
  ['gomti-home-electricals','Gomti Home Electricals','home-services','Gomti Nagar','Lucknow','Vijayant Khand, Amar Shaheed Path','Near City Mall','226010',[81.0202,26.8501],['Electrical repairs','Fan installation','Wiring inspection'],'budget',2016,8,['photo-1621905251189-08b45d6a269e','photo-1621905252507-b35492cc74b4']],
  ['saffron-salon-hazratganj','Saffron Salon & Spa','beauty-wellness','Hazratganj','Lucknow','14 Park Road','Behind Civil Hospital','226001',[80.9388,26.8514],['Hair styling','Facials','Bridal makeup'],'expensive',2017,11,['photo-1560066984-138dadb4c035','photo-1522337360788-8b13dee7a37e']],
  ['lucknow-learning-lab','Lucknow Learning Lab','education','Mahanagar','Lucknow','D Block, Mahanagar Extension','Near IT College Crossing','226006',[80.9519,26.8763],['Math tutoring','Science coaching','Exam preparation'],'moderate',2019,10,['photo-1509062522246-3755977927d7','photo-1503676260728-1c00da094a0b']],
  ['gomti-auto-care','Gomti Auto Care','automotive','Gomti Nagar Extension','Lucknow','Sushant Golf City Road','Near Lulu Mall','226030',[81.0087,26.7909],['Car servicing','AC repair','Wheel alignment'],'moderate',2014,14,['photo-1486262715619-67b85e0b08d3','photo-1486006920555-c77dcf18193c']],
  ['aminabad-threads','Aminabad Threads','shopping','Aminabad','Lucknow','36 Pratap Market','Near Jhandewala Park','226018',[80.9145,26.8462],['Chikankari apparel','Custom fitting','Gift wrapping'],'moderate',2008,12,['photo-1483985988355-763728e1935b','photo-1490481651871-ab68de25d43d']],
  ['kisan-legal-advisors','Kisan Legal Advisors','professional-services','Gomti Nagar','Lucknow','3rd Floor, Rohtas Summit','Vibhuti Khand','226010',[81.0066,26.8664],['Business registration','Contract review','Legal consultation'],'expensive',2013,6,['photo-1521791136064-7986c2920216','photo-1450101499163-c8848c66ca85']],
  ['sector-18-noida-coffee','Sector 18 Coffee Works','cafes-restaurants','Sector 18','Noida','G-42, Atta Market','Near Sector 18 Metro','201301',[77.3231,28.5708],['Coffee','Sandwiches','Remote-work seating'],'moderate',2021,8,['photo-1442512595331-e89e73853f31','photo-1495474472287-4d71bcdd2085']],
  ['noida-sector-50-wellness','Sector 50 Wellness Clinic','healthcare','Sector 50','Noida','B-Block Market','Near Noida City Centre','201303',[77.3657,28.5701],['Physiotherapy','Sports injury care','Posture assessment'],'moderate',2016,9,['photo-1576091160550-2173dba999ef','photo-1579684385127-1ef15d508118']],
  ['noida-sector-62-tech-tutors','Sector 62 Tech Tutors','education','Sector 62','Noida','C-Block, Institutional Area','Near Fortis Hospital','201309',[77.3649,28.6271],['Coding classes','Data analytics','Career mentoring'],'moderate',2022,13,['photo-1519389950473-47ba0277781c','photo-1516321318423-f06f85e504b3']],
  ['noida-sector-104-auto-clinic','Sector 104 Auto Clinic','automotive','Sector 104','Noida','Hazipur Main Road','Near Lotus Boulevard','201304',[77.3842,28.5358],['Two-wheeler servicing','Brake repair','Battery replacement'],'budget',2018,7,['photo-1487754180451-c456f719a1fc','photo-1504222490345-c075b6008014']],
];

const deadline = setTimeout(() => { console.error('Demo seed timed out. Check MongoDB connectivity.'); process.exit(1); }, 45000);
try {
  const config = parseEnv();
  await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false, autoCreate: false });
  // Development-only credentials. Set DEMO_SEED_PASSWORD in .env to override.
  const passwordHash = await bcrypt.hash(process.env.DEMO_SEED_PASSWORD || 'DemoPass123!', 12);
  const owner = await User.findOneAndUpdate({ email: 'demo.owner@example.com' }, {
    $set: { name: 'Demo Business Owner', role: 'business_owner', status: 'active', passwordHash },
    $setOnInsert: { email: 'demo.owner@example.com' },
  }, { new: true, upsert: true, runValidators: true });
  const admin = await User.findOneAndUpdate({ email: 'demo.admin@example.com' }, {
    $set: { name: 'Demo Admin', role: 'admin', status: 'active', passwordHash },
    $setOnInsert: { email: 'demo.admin@example.com' },
  }, { new: true, upsert: true, runValidators: true });
  const categoryMap = new Map();
  for (const [i, [slug, name, services]] of categoryRows.entries()) {
    const category = await Category.findOneAndUpdate({ slug }, { $set: {
      name, slug, description: `${name} sample category for the demo directory.`, services,
      keywords: [name, ...services], icon: 'storefront', image: photo('photo-1441986300917-64674bd600d8'), displayOrder: i, isActive: true,
    } }, { new: true, upsert: true, runValidators: true });
    categoryMap.set(slug, category);
  }
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  for (const [i, row] of rows.entries()) {
    const [slug,name,cat,locality,city,line,landmark,postal,coords,services,price,year,team,photos] = row;
    const category = categoryMap.get(cat);
    const rating = [4.8,4.6,4.7,4.9,4.5][i % 5];
    const phone = `+91987654${String(1000 + i).padStart(4, '0')}`;
    const data = {
      owner: owner._id, name, slug,
      description: `${name} is a fictional ${category.name.toLowerCase()} business serving ${locality}, ${city}. Friendly local service, clear pricing and convenient appointments for the neighbourhood.`,
      category: category._id, subcategories: [], services, phone, alternatePhone: `+91987655${String(1000 + i).padStart(4, '0')}`, whatsapp: phone,
      email: `hello+${slug}@demo.example.com`, website: `https://www.${slug}.example.com`,
      address: { addressLine1: line, addressLine2: 'First Floor', landmark, locality, city, state: 'Uttar Pradesh', postalCode: postal, country: 'IN' },
      location: { type: 'Point', coordinates: coords },
      workingHours: days.map((day, n) => n === 6 ? { day, isClosed: true } : { day, opens: n === 5 ? '10:00' : '09:00', closes: n === 5 ? '17:00' : '19:00', isClosed: false }),
      logo: photo(photos[0], 400), images: photos.map(id => photo(id)), photoCount: photos.length, priceRange: price,
      keywords: [category.name, locality, city, ...services], highlights: ['Locally owned', 'Easy appointment booking', 'Clear service information'],
      amenities: ['Digital payments', 'Air conditioning', 'Wheelchair access'], establishedYear: year, teamSize: team,
      responseTimeMinutes: 30 + (i % 4) * 15, mapEmbedUrl: `https://www.google.com/maps?q=${coords[1]},${coords[0]}&output=embed`,
      socialLinks: { facebook: `https://www.facebook.com/${slug}`, instagram: `https://www.instagram.com/${slug}`, linkedin: `https://www.linkedin.com/company/${slug}`, youtube: `https://www.youtube.com/@${slug}`, x: `https://x.com/${slug}` },
      faqs: [
        { question: 'Do I need to book in advance?', answer: 'Booking ahead is recommended. Call or message us to check availability.' },
        { question: 'Which payment methods do you accept?', answer: 'We accept cash and common digital payment methods.' },
      ],
      offers: [{ title: 'Welcome offer', description: 'Ask the team about the current first-visit offer.', code: `WELCOME${String(i + 1).padStart(2, '0')}`, validFrom: new Date('2026-01-01'), validUntil: new Date('2027-01-01'), isActive: true }],
      reviews: [
        { reviewerName: ['Aarav Sharma','Priya Verma','Kabir Singh'][i % 3], reviewerAvatar: photo('photo-1535713875002-d1d0cf377fde', 200), rating, comment: 'Helpful team, smooth experience and good service. Would recommend to others nearby.', isVerified: true, createdAt: new Date('2026-05-12T10:30:00Z') },
        { reviewerName: ['Meera Gupta','Rohan Mishra','Ananya Rao'][i % 3], reviewerAvatar: photo('photo-1494790108377-be9c29b29330', 200), rating: Math.max(1, rating - 0.3), comment: 'Convenient location and friendly staff. I would visit again.', isVerified: true, createdAt: new Date('2026-07-18T12:00:00Z') },
      ],
      testimonials: [{ name: 'Local customer', quote: 'A welcoming neighbourhood business with attentive service.', createdAt: new Date('2026-08-01T09:00:00Z') }],
      rejectionReason: undefined, timeZone: 'Asia/Kolkata', verificationStatus: 'verified', listingStatus: 'published',
      averageRating: rating, reviewCount: 2, viewCount: 120 + i * 37, isFeatured: i < 3,
      contactClickCount: 15 + i * 3, leadCount: 5 + i, featuredUntil: i < 3 ? new Date('2027-01-01') : undefined,
      deletedAt: null,
    };
    await Business.findOneAndUpdate({ slug }, { $set: data }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
  }
  const count = await Business.countDocuments({ slug: { $in: rows.map(row => row[0]) } });
  if (admin.role !== 'admin' || count !== rows.length) throw new Error('Demo record verification failed');
  console.log(JSON.stringify({ database: mongoose.connection.name, owner: owner.email, admin: admin.email, categories: categoryMap.size, businesses: count, cities: { Lucknow: 11, Noida: 4 }, verified: true }, null, 2));
} catch (error) {
  console.error('Demo seed failed:', error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[redacted URI]'));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
  clearTimeout(deadline);
}
