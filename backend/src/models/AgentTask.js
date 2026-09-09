/**
 * AgentTask Model
 *
 * Stores multi-step agent tasks, execution steps, tool results, and final responses.
 * Provides complete audit logging and execution telemetry for sovereign workbench tasks.
 */

import mongoose from "mongoose";
import { AGENT_STATUS } from "../services/agent/agent.types.js";

const StepSchema = new mongoose.Schema(
  {
    stepNumber: {
      type: Number,
      required: true,
    },
    action: {
      type: String,
      enum: ["tool", "final", "error", "plan"],
      required: true,
    },
    toolName: {
      type: String,
      default: null,
    },
    reason: {
      type: String,
      default: null,
    },
    input: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    output: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      enum: ["completed", "failed", "skipped"],
      default: "completed",
    },
    executionTimeMs: {
      type: Number,
      default: 0,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const AgentTaskSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(),
    },
    taskId: {
      type: String,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    chatId: {
      type: String,
      default: null,
      index: true,
    },
    workspaceId: {
      type: String,
      default: "default",
    },
    userRequest: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(AGENT_STATUS),
      default: AGENT_STATUS.PLANNING,
      index: true,
    },
    currentStep: {
      type: Number,
      default: 0,
    },
    steps: {
      type: [StepSchema],
      default: [],
    },
    toolResults: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    finalResponse: {
      type: String,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        ret.taskId = ret.taskId || ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Synchronize taskId with _id before save if empty
AgentTaskSchema.pre("save", function (next) {
  if (!this.taskId) {
    this.taskId = this._id;
  }
  next();
});

const AgentTask =
  mongoose.models.AgentTask || mongoose.model("AgentTask", AgentTaskSchema);

export default AgentTask;
