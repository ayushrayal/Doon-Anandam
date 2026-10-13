import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';

/**
 * Initial Admin Bootstrap Script
 *
 * Usage (PowerShell):
 *   $env:ADMIN_NAME="Initial Admin"
 *   $env:ADMIN_EMAIL="admin@doonanandam.com"
 *   $env:ADMIN_PASSWORD="YourStrongPassword123!"
 *   node scripts/bootstrapAdmin.js
 *
 * Cleanup:
 *   Remove-Item Env:ADMIN_NAME, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
 */
async function bootstrapAdmin() {
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!name || name.length < 2) {
    console.error('[Bootstrap Error] ADMIN_NAME must be provided and at least 2 characters long.');
    process.exit(1);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    console.error('[Bootstrap Error] A valid ADMIN_EMAIL must be provided.');
    process.exit(1);
  }

  if (!password || password.length < 8) {
    console.error(
      '[Bootstrap Error] ADMIN_PASSWORD must be provided and at least 8 characters long.'
    );
    process.exit(1);
  }

  console.log('[Bootstrap] Initializing database connection...');
  try {
    await connectDB();
  } catch (dbErr) {
    console.error('[Bootstrap Error] Database connection failed:', dbErr.message);
    process.exit(1);
  }

  try {
    // 1. Check if user with this email already exists
    const userWithEmail = await User.findOne({ email });
    if (userWithEmail) {
      console.error(`[Bootstrap Error] User with email "${email}" already exists. Refusing to overwrite.`);
      await disconnectDB();
      process.exit(1);
    }

    // 2. Check if an admin account already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      console.error(
        `[Bootstrap Error] An Admin account already exists ("${existingAdmin.email}"). Bootstrap script only creates the initial admin.`
      );
      await disconnectDB();
      process.exit(1);
    }

    // 3. Hash password with bcrypt cost factor 12
    console.log('[Bootstrap] Generating secure password hash...');
    const passwordHash = await bcrypt.hash(password, 12);

    // 4. Create initial Admin user
    const admin = await User.create({
      name,
      email,
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    console.log(`[Bootstrap Success] Initial Admin user created successfully.`);
    console.log(`[Bootstrap Success] ID: ${admin._id}`);
    console.log(`[Bootstrap Success] Name: ${admin.name}`);
    console.log(`[Bootstrap Success] Email: ${admin.email}`);
    console.log(`[Bootstrap Success] Role: ${admin.role}`);
    console.log(
      '\n[Security Reminder] Please remove ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD from your environment variables.'
    );

    await disconnectDB();
    process.exit(0);
  } catch (err) {
    console.error('[Bootstrap Error] Failed to create admin user:', err.message);
    await disconnectDB();
    process.exit(1);
  }
}

bootstrapAdmin();
