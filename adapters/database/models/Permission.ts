import mongoose, { Schema, Document, Model } from 'mongoose';

// 1. Interface for the Permission document
export interface IPermission extends Document {
  sharedwith: mongoose.Types.ObjectId;
  permission: 'read' | 'write' | 'admin';
  resource_id: mongoose.Types.ObjectId;
  resource_type: 'file' | 'folder';
  createdAt?: Date;
  updatedAt?: Date;
}

// 2. Schema definition with types
const PermissionSchema: Schema<IPermission> = new Schema(
  {
    sharedwith: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'sharedwith user is required'],
    },
    permission: {
      type: String,
      enum: ['read', 'write', 'admin'],
      required: [true, 'Permission level is required'],
    },
    resource_id: {
      type: Schema.Types.ObjectId,
      required: [true, 'Resource ID is required'],
    },
    resource_type: {
      type: String,
      enum: ['file', 'folder'],
      required: [true, 'Resource type is required'],
    },
  },
  { timestamps: true }
);

// 3. Indexes
PermissionSchema.index({ sharedwith: 1, resource_id: 1 });
PermissionSchema.index({ resource_id: 1, resource_type: 1 });

// Prevent duplicate permission entries
PermissionSchema.index(
  { sharedwith: 1, resource_id: 1, resource_type: 1 },
  { unique: true }
);

// 4. Model typing (important for Next.js / hot reload)
const Permission: Model<IPermission> =
  mongoose.models.Permission ||
  mongoose.model<IPermission>('Permission', PermissionSchema);

export default Permission;