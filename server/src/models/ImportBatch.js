import mongoose from 'mongoose';

/**
 * ImportBatch Schema for Doon Anandam CRM
 *
 * Tracks the lifecycle of bulk lead imports:
 * - Preview stage (with 30-minute TTL expiry for unconfirmed uploads)
 * - Validation, duplicate skip tracking, and error reporting
 * - Permanent historical provenance for completed batches
 */
const importBatchSchema = new mongoose.Schema(
  {
    accountId: {
      type: String,
      required: [true, 'Account ID is required'],
      trim: true,
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Uploader user reference is required'],
    },
    originalFilename: {
      type: String,
      required: [true, 'Original filename is required'],
      trim: true,
      maxlength: [255, 'Filename cannot exceed 255 characters'],
    },
    fileSizeBytes: {
      type: Number,
      required: [true, 'File size in bytes is required'],
    },
    status: {
      type: String,
      enum: {
        values: ['preview', 'processing', 'completed', 'failed', 'expired'],
        message: '{VALUE} is not a valid batch status',
      },
      default: 'preview',
      index: true,
    },
    totalRows: {
      type: Number,
      default: 0,
    },
    validCount: {
      type: Number,
      default: 0,
    },
    duplicateCount: {
      type: Number,
      default: 0,
    },
    errorCount: {
      type: Number,
      default: 0,
    },
    ignoredColumns: {
      type: [String],
      default: [],
    },
    summary: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    rows: [
      {
        rowNumber: { type: Number, required: true },
        data: { type: mongoose.Schema.Types.Mixed, default: {} },
        status: {
          type: String,
          enum: ['valid', 'duplicate', 'error'],
          required: true,
        },
        reason: { type: String, default: '' },
        validationErrors: { type: [String], default: [] },
      },
    ],
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index to automatically prune unconfirmed previews after expiry (expiresAt)
// When a batch is completed, expiresAt is cleared (set to null), permanently preserving history
importBatchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound query index for account-scoped batch history
importBatchSchema.index({ accountId: 1, createdAt: -1 });

const ImportBatch =
  mongoose.models.ImportBatch || mongoose.model('ImportBatch', importBatchSchema);

export default ImportBatch;
