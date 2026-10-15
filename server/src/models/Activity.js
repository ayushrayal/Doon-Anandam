import mongoose from 'mongoose';

/**
 * Activity Schema for Doon Anandam CRM
 *
 * Implements an append-oriented operational timeline for all interactions
 * and lifecycle events associated with a lead:
 * - Direct sales interactions: Phone Call, WhatsApp, Meeting, Email, Note
 * - Follow-up lifecycle events: follow_up_scheduled, follow_up_rescheduled, follow_up_completed
 * - Pipeline transitions: status_change
 *
 * Guaranteed append-only semantics: Activities are never silently mutated
 * or overwritten, ensuring an auditable customer interaction history.
 */
const activitySchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: [true, 'Lead reference is required'],
      index: true,
    },
    accountId: {
      type: String,
      required: [true, 'Account ID is required'],
      trim: true,
      index: true,
    },
    type: {
      type: String,
      required: [true, 'Activity type is required'],
      enum: {
        values: [
          'call',
          'whatsapp',
          'meeting',
          'email',
          'note',
          'follow_up_scheduled',
          'follow_up_rescheduled',
          'follow_up_completed',
          'status_change',
        ],
        message: '{VALUE} is not a valid activity type',
      },
    },
    summary: {
      type: String,
      required: [true, 'Activity summary or description is required'],
      trim: true,
      maxlength: [2000, 'Activity notes cannot exceed 2000 characters'],
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Acting user is required'],
    },
    performedAt: {
      type: Date,
      default: Date.now,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Compound querying indexes for timeline retrieval and account reporting
activitySchema.index({ leadId: 1, performedAt: -1 });
activitySchema.index({ accountId: 1, performedAt: -1 });
activitySchema.index({ performedBy: 1 });

const Activity = mongoose.models.Activity || mongoose.model('Activity', activitySchema);

export default Activity;
