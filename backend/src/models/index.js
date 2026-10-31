import mongoose from "mongoose";

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    // `emailVerified` is set explicitly on create. It is deliberately NOT given a schema default so
    // accounts created before verification existed (field absent) keep working.
    emailVerified: Boolean,
    verifyCodeHash: { type: String, select: false },
    verifyTokenHash: { type: String, select: false },
    verifyExpires: { type: Date, select: false },
    verifyAttempts: { type: Number, select: false },
    verifySentAt: { type: Date, select: false },
    resetCodeHash: { type: String, select: false },
    resetExpires: { type: Date, select: false },
    resetAttempts: { type: Number, select: false },
    resetSentAt: { type: Date, select: false },
    tokenVersion: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const projectSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: { type: String, required: true },
    name: { type: String, required: true, maxlength: 200 },
    languages: [String],
    technologies: [String],
    frameworks: [String],
    dependencies: [String],
    databases: [String],
    authenticationLibraries: [String],
    architecture: [String],
    packageManager: String,
    summary: { type: String, maxlength: 4000 },
    analyzedAt: Date
  },
  { timestamps: true }
);
projectSchema.index({ userId: 1, clientId: 1 }, { unique: true });

const knowledgeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: { type: String, required: true },
    projectClientId: String,
    project: { type: String, index: true },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true, maxlength: 300 },
    content: { type: String, required: true, maxlength: 20000 },
    tags: [String],
    source: String,
    sourceFile: String,
    sourceLine: Number,
    contentHash: String,
    embedding: { type: [Number], select: false },
    embeddingModel: String
  },
  { timestamps: true }
);
knowledgeSchema.index({ userId: 1, clientId: 1 }, { unique: true });

const debugSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    knowledgeClientId: { type: String, required: true },
    project: String,
    error: { type: String, maxlength: 20000 },
    cause: { type: String, maxlength: 5000 },
    solution: { type: String, maxlength: 10000 },
    tags: [String]
  },
  { timestamps: true }
);
debugSchema.index({ userId: 1, knowledgeClientId: 1 }, { unique: true });

const searchHistorySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    query: { type: String, maxlength: 1000 },
    mode: { type: String, enum: ["semantic", "ask"] },
    resultCount: Number
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

export const User = model("User", userSchema);
export const Project = model("Project", projectSchema);
export const KnowledgeEntry = model("KnowledgeEntry", knowledgeSchema);
export const DebugEntry = model("DebugEntry", debugSchema);
export const SearchHistory = model("SearchHistory", searchHistorySchema);
