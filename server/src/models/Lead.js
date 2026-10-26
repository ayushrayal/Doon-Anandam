import mongoose from 'mongoose';

/**
 * Lead Schema for Doon Anandam CRM
 *
 * Implements deduplication via a compound unique index on:
 *   { source: 1, accountId: 1, externalLeadId: 1 }
 *
 * Upstream synchronization updates metadata without overwriting CRM-owned operational state
 * (status, assignedTo, internal notes).
 */
const leadSchema = new mongoose.Schema(
  {
    externalLeadId: {
      type: String,
      required: [true, 'External lead ID is required'],
      trim: true,
      maxlength: [120, 'External lead ID cannot exceed 120 characters'],
    },
    source: {
      type: String,
      required: [true, 'Lead source identifier is required'],
      trim: true,
      default: 'meta',
      maxlength: [60, 'Lead source cannot exceed 60 characters'],
    },
    syncProvider: {
      type: String,
      trim: true,
      default: 'windsor.ai',
      maxlength: [60, 'Sync provider cannot exceed 60 characters'],
    },
    accountId: {
      type: String,
      required: [true, 'Account ID is required'],
      trim: true,
      maxlength: [120, 'Account ID cannot exceed 120 characters'],
    },
    accountName: {
      type: String,
      trim: true,
      default: '',
      maxlength: [200, 'Account name cannot exceed 200 characters'],
    },
    fullName: {
      type: String,
      trim: true,
      default: '',
      maxlength: [200, 'Full name cannot exceed 200 characters'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      maxlength: [200, 'Email address cannot exceed 200 characters'],
    },
    phoneNumber: {
      type: String,
      trim: true,
      default: null,
      maxlength: [50, 'Phone number cannot exceed 50 characters'],
    },
    formId: {
      type: String,
      trim: true,
      default: '',
      maxlength: [120, 'Form ID cannot exceed 120 characters'],
    },
    formName: {
      type: String,
      trim: true,
      default: '',
      maxlength: [250, 'Form name cannot exceed 250 characters'],
    },
    campaignName: {
      type: String,
      trim: true,
      default: '',
      maxlength: [250, 'Campaign name cannot exceed 250 characters'],
    },
    campaignId: {
      type: String,
      trim: true,
      default: '',
      maxlength: [120, 'Campaign ID cannot exceed 120 characters'],
    },
    adsetName: {
      type: String,
      trim: true,
      default: '',
      maxlength: [250, 'AdSet name cannot exceed 250 characters'],
    },
    adName: {
      type: String,
      trim: true,
      default: '',
      maxlength: [250, 'Ad name cannot exceed 250 characters'],
    },
    leadCreatedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      required: [true, 'Lead status is required'],
      enum: {
        values: ['new', 'contacted', 'follow_up', 'qualified', 'lost', 'converted'],
        message: '{VALUE} is not a valid lead status',
      },
      default: 'new',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'Notes cannot exceed 2000 characters'],
    },
    nextFollowUpDate: {
      type: Date,
      default: null,
    },
    nextFollowUpRemarks: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Follow-up remarks cannot exceed 500 characters'],
    },
    lastFollowUpCompletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index ensuring that duplicate upstream syncs do not insert duplicate leads
leadSchema.index({ source: 1, accountId: 1, externalLeadId: 1 }, { unique: true });

// Operational querying indexes
leadSchema.index({ status: 1 });
leadSchema.index({ assignedTo: 1 });
leadSchema.index({ leadCreatedAt: -1 });
leadSchema.index({ nextFollowUpDate: 1 });

// High-performance compound operational indexes (scoped by accountId)
leadSchema.index({ accountId: 1, createdAt: -1 });
leadSchema.index({ accountId: 1, assignedTo: 1, createdAt: -1 });
leadSchema.index({ accountId: 1, status: 1, createdAt: -1 });
leadSchema.index({ accountId: 1, nextFollowUpDate: 1 });
leadSchema.index({ accountId: 1, leadCreatedAt: -1 });

const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);

export default Lead;
