import mongoose from 'mongoose';

/**
 * User Schema for Doon Anandam CRM
 *
 * NOTE ON UNIQUE INDEX:
 * In Mongoose, `unique: true` on the `email` field is an index declaration, NOT a schema validator.
 * Mongoose tells MongoDB to maintain a unique index on this field.
 * Because validation middleware does not prevent concurrent duplicate inserts,
 * application logic (in the future user creation service) must handle MongoDB E11000 duplicate key
 * errors and/or perform pre-flight existence checks.
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      unique: true, // MongoDB unique index definition
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address',
      ],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      // Plain-text passwords must never be stored
    },
    role: {
      type: String,
      enum: {
        values: ['admin', 'sales_executive'],
        message: '{VALUE} is not a valid role',
      },
      default: 'sales_executive',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

export default User;
