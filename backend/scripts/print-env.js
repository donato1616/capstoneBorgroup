require('dotenv').config();
try {
  const u = new URL(process.env.DATABASE_URL || '');
  // mask password
  u.password = u.password ? '*****' : '';
  console.log('DATABASE_URL host:port:', `${u.hostname}:${u.port || '5432'}`);
  console.log('DATABASE_URL db:', u.pathname);
  console.log('Query flags:', u.searchParams.toString());
} catch (e) {
  console.log('DATABASE_URL not set or invalid.')
};