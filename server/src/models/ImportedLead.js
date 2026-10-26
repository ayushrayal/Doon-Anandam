import mongoose from 'mongoose';

/**
 * ImportedLead Schema for Doon Anandam CRM
 *
 * Dedicated collection for client leads ingested via the Excel Import module.
 * Fully decoupled from the Meta/Windsor Leads collection:
 * - Never mixed into the Meta/Windsor Leads listing (/api/leads)
 * - Immune to upstream Windsor.ai synchronization overrides
 * - Preserves authentic acquisition source labels (Meta, Website, Walk-in, Referral, etc.)
 * - Native follow-up scheduling and append-only activity tracking
 */
const importedLeadSchema = new mongoose.Schema(
  {
    accountId: {
      type: String,
      required: [true, 'Account ID is required'],
      trim: true,
      index: true,
      maxlength: [120, 'Account ID cannot exceed 120 characters'],
    },
    importBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ImportBatch',
      required: [true, 'Import batch ID is required'],
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Uploader user ID is required'],
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: [200, 'Full name cannot exceed 200 characters'],
    },
    phoneNumber: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      maxlength: [50, 'Phone number cannot exceed 50 characters'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      maxlength: [200, 'Email address cannot exceed 200 characters'],
    },
    status: {
      type: String,
      required: [true, 'Lead status is required'],
      enum: {
        values: ['new', 'contacted', 'follow_up', 'qualified', 'lost', 'converted'],
        message: '{VALUE} is not a valid lead status',
      },
      default: 'new',
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    source: {
      type: String,
      trim: true,
      default: 'manual',
      maxlength: [60, 'Lead source cannot exceed 60 characters'],
    },
    campaignName: {
      type: String,
      trim: true,
      default: '',
      maxlength: [250, 'Campaign name cannot exceed 250 characters'],
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
      index: true,
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
    leadCreatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    externalLeadId: {
      type: String,
      trim: true,
      default: '',
      maxlength: [120, 'External lead ID cannot exceed 120 characters'],
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'imported_leads',
  }
);

// High-performance operational querying indexes
importedLeadSchema.index({ accountId: 1, isDeleted: 1, createdAt: -1 });
importedLeadSchema.index({ accountId: 1, createdAt: -1 });
importedLeadSchema.index({ accountId: 1, assignedTo: 1, createdAt: -1 });
importedLeadSchema.index({ accountId: 1, status: 1, createdAt: -1 });
importedLeadSchema.index({ accountId: 1, phoneNumber: 1 });
importedLeadSchema.index({ accountId: 1, email: 1 });
importedLeadSchema.index({ accountId: 1, nextFollowUpDate: 1 });

const ImportedLead =
  mongoose.models.ImportedLead ||
  mongoose.model('ImportedLead', importedLeadSchema, 'imported_leads');

export default ImportedLead;
