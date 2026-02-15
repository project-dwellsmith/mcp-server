#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Config ───────────────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), ".dwellsmith-mcp.json");

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    console.error(
      "No config found. Run `node setup.js` first to authenticate.\n" +
      `Expected config at: ${CONFIG_PATH}`
    );
    process.exit(1);
  }
}

const config = loadConfig();
const BASE_URL = config.baseUrl || "https://dwellsmith.com";
const TOKEN = config.token;

if (!TOKEN) {
  console.error("No token in config. Run `node setup.js` to authenticate.");
  process.exit(1);
}

// ── API helper ───────────────────────────────────────────────────────────────

const TIMEOUT = 30_000;

async function api(method, path, body) {
  const url = `${BASE_URL}/api/v1${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT),
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const detail = data?.message || data?.error || JSON.stringify(data);
    switch (res.status) {
      case 401: throw new Error(`Authentication failed — run setup.js again (${detail})`);
      case 403: throw new Error(`Not authorized (${detail})`);
      case 404: throw new Error(`Not found (${detail})`);
      case 422: throw new Error(`Validation error: ${detail}`);
      case 429: throw new Error("Rate limited — wait a moment and try again");
      default:
        if (res.status >= 500) throw new Error(`Server error (${res.status}) — try again shortly`);
        throw new Error(`API error ${res.status}: ${detail}`);
    }
  }

  return data;
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function jsonResult(data) {
  return textResult(JSON.stringify(data, null, 2));
}

function errorResult(err) {
  return textResult(`❌ ${err.message}`);
}

// ── Validation helpers ───────────────────────────────────────────────────────

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format").refine((s) => {
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime());
}, "Invalid date — check month and day values");

const idSchema = z.number().int().positive("ID must be a positive integer");

// ── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "dwellsmith",
  version: "0.1.0",
});

// ── health_check ─────────────────────────────────────────────────────────────

server.tool(
  "health_check",
  "Test the connection to Dwellsmith — verifies authentication and API availability",
  {},
  async () => {
    try {
      const start = Date.now();
      const data = await api("GET", "/household");
      const elapsed = Date.now() - start;
      const householdName = data.data?.name || "Unknown";
      return textResult(
        `✅ Connected to Dwellsmith\n` +
        `• Household: ${householdName}\n` +
        `• API: ${BASE_URL}\n` +
        `• Response time: ${elapsed}ms`
      );
    } catch (err) {
      return textResult(
        `❌ Connection failed\n` +
        `• API: ${BASE_URL}\n` +
        `• Error: ${err.message}\n\n` +
        `Try running \`node setup.js\` to re-authenticate.`
      );
    }
  }
);

// ── list_tasks ───────────────────────────────────────────────────────────────

server.tool(
  "list_tasks",
  "List household tasks with optional filters",
  {
    status: z.enum(["pending", "completed", "overdue", "all"]).optional().describe("Filter by status"),
    due: z.enum(["today", "week", "overdue"]).optional().describe("Filter by due date"),
    category: z.string().optional().describe("Filter by category"),
  },
  async ({ status, due, category }) => {
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (due) params.set("due", due);
      if (category) params.set("category", category);
      const qs = params.toString();
      const data = await api("GET", `/tasks${qs ? `?${qs}` : ""}`);
      if (!data.data?.length) return textResult("No tasks found matching those filters.");
      const lines = data.data.map(t =>
        `• [${t.id}] ${t.title}${t.due_date ? ` (due: ${t.due_date})` : ""}${t.priority ? ` P${t.priority}` : ""}${t.category ? ` [${t.category}]` : ""}${t.is_overdue ? " ⚠️ OVERDUE" : ""}`
      );
      return textResult(lines.join("\n"));
    } catch (err) { return errorResult(err); }
  }
);

// ── create_task ──────────────────────────────────────────────────────────────

server.tool(
  "create_task",
  "Create a new household task",
  {
    title: z.string().min(1, "Title cannot be empty").max(500).describe("Task title"),
    description: z.string().optional().describe("Task description"),
    category: z.string().optional().describe("Category (e.g. cleaning, errands, repairs)"),
    priority: z.number().min(1).max(5).optional().describe("Priority 1-5 (1=highest)"),
    due_date: dateSchema.optional().describe("Due date (YYYY-MM-DD)"),
    recurrence: z.string().optional().describe("Recurrence type: daily, weekly, monthly, or null for one-time"),
  },
  async ({ title, description, category, priority, due_date, recurrence }) => {
    try {
      const body = { title };
      if (description) body.description = description;
      if (category) body.category = category;
      if (priority) body.priority = priority;
      if (due_date) body.due_date = due_date;
      if (recurrence) body.recurrence_type = recurrence;
      const data = await api("POST", "/tasks", body);
      return textResult(`✅ Task created: "${data.data?.title || title}" (ID: ${data.data?.id})`);
    } catch (err) { return errorResult(err); }
  }
);

// ── update_task ──────────────────────────────────────────────────────────────

server.tool(
  "update_task",
  "Update an existing task's details",
  {
    id: idSchema.describe("Task ID"),
    title: z.string().min(1).max(500).optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    category: z.string().optional().describe("New category"),
    priority: z.number().min(1).max(5).optional().describe("New priority 1-5"),
    due_date: dateSchema.optional().describe("New due date (YYYY-MM-DD)"),
  },
  async ({ id, title, description, category, priority, due_date }) => {
    try {
      const body = {};
      if (title !== undefined) body.title = title;
      if (description !== undefined) body.description = description;
      if (category !== undefined) body.category = category;
      if (priority !== undefined) body.priority = priority;
      if (due_date !== undefined) body.due_date = due_date;
      if (Object.keys(body).length === 0) return textResult("Nothing to update — provide at least one field to change.");
      const data = await api("PUT", `/tasks/${id}`, body);
      return textResult(`✅ Task ${id} updated.`);
    } catch (err) { return errorResult(err); }
  }
);

// ── delete_task ──────────────────────────────────────────────────────────────

server.tool(
  "delete_task",
  "Delete a task permanently",
  {
    id: idSchema.describe("Task ID"),
  },
  async ({ id }) => {
    try {
      await api("DELETE", `/tasks/${id}`);
      return textResult(`✅ Task ${id} deleted.`);
    } catch (err) { return errorResult(err); }
  }
);

// ── complete_task ────────────────────────────────────────────────────────────

server.tool(
  "complete_task",
  "Mark a task as complete",
  {
    id: idSchema.describe("Task ID"),
    notes: z.string().optional().describe("Completion notes"),
  },
  async ({ id, notes }) => {
    try {
      const body = notes ? { notes } : undefined;
      const data = await api("POST", `/tasks/${id}/complete`, body);
      let msg = `✅ Task ${id} completed.`;
      if (data.data?.next_due_date) msg += ` Next due: ${data.data.next_due_date}`;
      return textResult(msg);
    } catch (err) { return errorResult(err); }
  }
);

// ── get_household ────────────────────────────────────────────────────────────

server.tool(
  "get_household",
  "Get household summary dashboard — overdue tasks, contacts due, maintenance status",
  {},
  async () => {
    try {
      const data = await api("GET", "/household");
      return jsonResult(data.data || data);
    } catch (err) { return errorResult(err); }
  }
);

// ── list_relationships ───────────────────────────────────────────────────────

server.tool(
  "list_relationships",
  "List tracked relationships/contacts",
  {
    category: z.string().optional().describe("Filter by category (family, friend, etc.)"),
    search: z.string().optional().describe("Search by name"),
  },
  async ({ category, search }) => {
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (search) params.set("search", search);
      const qs = params.toString();
      const data = await api("GET", `/relationships${qs ? `?${qs}` : ""}`);
      if (!data.data?.length) return textResult("No relationships found.");
      const lines = data.data.map(r =>
        `• [${r.id}] ${r.name} (${r.category || "uncategorized"})${r.last_contact_date ? ` — last contact: ${r.last_contact_date}` : ""}${r.is_overdue ? " ⚠️ OVERDUE" : ""}`
      );
      return textResult(lines.join("\n"));
    } catch (err) { return errorResult(err); }
  }
);

// ── create_relationship ──────────────────────────────────────────────────────

server.tool(
  "create_relationship",
  "Add a new relationship/contact to track",
  {
    name: z.string().min(1, "Name cannot be empty").max(200).describe("Person's name"),
    category: z.string().optional().describe("Category (family, friend, neighbor, coworker, etc.)"),
    contact_frequency_days: z.number().int().positive().optional().describe("How often to stay in touch (days)"),
    notes: z.string().optional().describe("Notes about this person"),
  },
  async ({ name, category, contact_frequency_days, notes }) => {
    try {
      const body = { name };
      if (category) body.category = category;
      if (contact_frequency_days) body.contact_frequency_days = contact_frequency_days;
      if (notes) body.notes = notes;
      const data = await api("POST", "/relationships", body);
      return textResult(`✅ Relationship added: "${data.data?.name || name}" (ID: ${data.data?.id})`);
    } catch (err) { return errorResult(err); }
  }
);

// ── due_contacts ─────────────────────────────────────────────────────────────

server.tool(
  "due_contacts",
  "List relationships that are due or overdue for contact",
  {},
  async () => {
    try {
      const data = await api("GET", "/relationships/due");
      if (!data.data?.length) return textResult("🎉 Everyone is up to date — no contacts due!");
      const lines = data.data.map(r =>
        `• [${r.id}] ${r.name} — ${r.days_since_contact || "?"} days since last contact (goal: every ${r.contact_frequency_days || "?"} days)`
      );
      return textResult("Contacts due:\n" + lines.join("\n"));
    } catch (err) { return errorResult(err); }
  }
);

// ── log_interaction ──────────────────────────────────────────────────────────

server.tool(
  "log_interaction",
  "Log an interaction with a relationship (call, text, visit, etc.)",
  {
    id: idSchema.describe("Relationship ID"),
    type: z.enum(["call", "text", "email", "visit", "video_call"]).describe("Interaction type"),
    initiated_by: z.enum(["us", "them", "mutual"]).optional().describe("Who initiated"),
    duration_minutes: z.number().optional().describe("Duration in minutes"),
    notes: z.string().optional().describe("Notes about the interaction"),
    date: dateSchema.optional().describe("Date of interaction (YYYY-MM-DD), defaults to today"),
  },
  async ({ id, type, initiated_by, duration_minutes, notes, date }) => {
    try {
      const body = { type };
      if (initiated_by) body.initiated_by = initiated_by;
      if (duration_minutes) body.duration_minutes = duration_minutes;
      if (notes) body.notes = notes;
      if (date) body.date = date;
      const data = await api("POST", `/relationships/${id}/interactions`, body);
      return textResult(`✅ Logged ${type} with relationship ${id}.`);
    } catch (err) { return errorResult(err); }
  }
);

// ── list_helpers ─────────────────────────────────────────────────────────────

server.tool(
  "list_helpers",
  "List household helpers (cleaners, dog walkers, etc.)",
  {
    active_only: z.boolean().optional().default(true).describe("Only show active helpers"),
  },
  async ({ active_only }) => {
    try {
      const params = new URLSearchParams();
      if (active_only) params.set("active_only", "true");
      const qs = params.toString();
      const data = await api("GET", `/helpers${qs ? `?${qs}` : ""}`);
      if (!data.data?.length) return textResult("No helpers found.");
      const lines = data.data.map(h =>
        `• [${h.id}] ${h.name} — ${h.role || "helper"}${h.rate ? ` ($${h.rate})` : ""}`
      );
      return textResult(lines.join("\n"));
    } catch (err) { return errorResult(err); }
  }
);

// ── create_helper ────────────────────────────────────────────────────────────

server.tool(
  "create_helper",
  "Add a new household helper (cleaner, dog walker, handyman, etc.)",
  {
    name: z.string().min(1, "Name cannot be empty").max(200).describe("Helper's name"),
    role: z.string().optional().describe("Role (cleaner, dog walker, handyman, babysitter, etc.)"),
    rate: z.number().positive().optional().describe("Standard rate/payment amount"),
    phone: z.string().optional().describe("Phone number"),
    email: z.string().email().optional().describe("Email address"),
    notes: z.string().optional().describe("Notes about this helper"),
  },
  async ({ name, role, rate, phone, email, notes }) => {
    try {
      const body = { name };
      if (role) body.role = role;
      if (rate) body.rate = rate;
      if (phone) body.phone = phone;
      if (email) body.email = email;
      if (notes) body.notes = notes;
      const data = await api("POST", "/helpers", body);
      return textResult(`✅ Helper added: "${data.data?.name || name}" (ID: ${data.data?.id})`);
    } catch (err) { return errorResult(err); }
  }
);

// ── log_visit ────────────────────────────────────────────────────────────────

server.tool(
  "log_visit",
  "Log a helper visit",
  {
    id: idSchema.describe("Helper ID"),
    visit_date: dateSchema.optional().describe("Visit date (YYYY-MM-DD), defaults to today"),
    notes: z.string().optional().describe("Notes about the visit"),
  },
  async ({ id, visit_date, notes }) => {
    try {
      const body = {};
      if (visit_date) body.visit_date = visit_date;
      if (notes) body.notes = notes;
      const data = await api("POST", `/helpers/${id}/visits`, body);
      return textResult(`✅ Visit logged for helper ${id}.`);
    } catch (err) { return errorResult(err); }
  }
);

// ── log_payment ──────────────────────────────────────────────────────────────

server.tool(
  "log_payment",
  "Log a payment to a helper",
  {
    id: idSchema.describe("Helper ID"),
    amount: z.number().positive("Amount must be greater than zero").describe("Payment amount"),
    payment_method: z.string().optional().describe("Payment method (cash, venmo, check, etc.)"),
    visit_date: dateSchema.optional().describe("For which visit date (YYYY-MM-DD)"),
    notes: z.string().optional().describe("Payment notes"),
  },
  async ({ id, amount, payment_method, visit_date, notes }) => {
    try {
      const body = { amount };
      if (payment_method) body.payment_method = payment_method;
      if (visit_date) body.visit_date = visit_date;
      if (notes) body.notes = notes;
      const data = await api("POST", `/helpers/${id}/payments`, body);
      return textResult(`✅ Payment of $${amount} logged for helper ${id}.`);
    } catch (err) { return errorResult(err); }
  }
);

// ── list_maintenance ─────────────────────────────────────────────────────────

server.tool(
  "list_maintenance",
  "List home maintenance items",
  {
    filter: z.enum(["overdue", "due_soon", "all"]).optional().describe("Filter maintenance items"),
    category: z.string().optional().describe("Filter by category"),
  },
  async ({ filter, category }) => {
    try {
      const params = new URLSearchParams();
      if (filter) params.set("filter", filter);
      if (category) params.set("category", category);
      const qs = params.toString();
      const data = await api("GET", `/maintenance${qs ? `?${qs}` : ""}`);
      if (!data.data?.length) return textResult("No maintenance items found.");
      const lines = data.data.map(m =>
        `• [${m.id}] ${m.title}${m.next_due_date ? ` (due: ${m.next_due_date})` : ""}${m.category ? ` [${m.category}]` : ""}${m.is_overdue ? " ⚠️ OVERDUE" : ""}`
      );
      return textResult(lines.join("\n"));
    } catch (err) { return errorResult(err); }
  }
);

// ── create_maintenance ───────────────────────────────────────────────────────

server.tool(
  "create_maintenance",
  "Add a new home maintenance item to track",
  {
    title: z.string().min(1, "Title cannot be empty").max(500).describe("Maintenance item title"),
    description: z.string().optional().describe("Detailed description"),
    category: z.string().optional().describe("Category (HVAC, plumbing, exterior, appliances, etc.)"),
    frequency_days: z.number().int().positive().optional().describe("Recurrence frequency in days"),
    next_due_date: dateSchema.optional().describe("Next due date (YYYY-MM-DD)"),
  },
  async ({ title, description, category, frequency_days, next_due_date }) => {
    try {
      const body = { title };
      if (description) body.description = description;
      if (category) body.category = category;
      if (frequency_days) body.frequency_days = frequency_days;
      if (next_due_date) body.next_due_date = next_due_date;
      const data = await api("POST", "/maintenance", body);
      return textResult(`✅ Maintenance item added: "${data.data?.title || title}" (ID: ${data.data?.id})`);
    } catch (err) { return errorResult(err); }
  }
);

// ── complete_maintenance ─────────────────────────────────────────────────────

server.tool(
  "complete_maintenance",
  "Mark a maintenance item as complete",
  {
    id: idSchema.describe("Maintenance item ID"),
    notes: z.string().optional().describe("Completion notes"),
  },
  async ({ id, notes }) => {
    try {
      const body = notes ? { notes } : undefined;
      const data = await api("POST", `/maintenance/${id}/complete`, body);
      let msg = `✅ Maintenance item ${id} completed.`;
      if (data.data?.next_due_date) msg += ` Next due: ${data.data.next_due_date}`;
      return textResult(msg);
    } catch (err) { return errorResult(err); }
  }
);

// ── quick_capture ────────────────────────────────────────────────────────────

server.tool(
  "quick_capture",
  "Natural language capture — describe what happened and it will be routed to the right tool. Examples: 'called Mom', 'completed laundry task', 'dog walker came Tuesday', 'pay Maria $150'",
  {
    text: z.string().min(1, "Text cannot be empty").max(1000).describe("Natural language description of what to capture"),
  },
  async ({ text }) => {
    try {
      const parsed = parseCapture(text);
      if (!parsed) {
        return textResult(`🤷 Couldn't parse: "${text}". Try being more specific, or use the individual tools directly.`);
      }

      // Execute the parsed action
      switch (parsed.action) {
        case "complete_task": {
          const body = parsed.notes ? { notes: parsed.notes } : undefined;
          // Search for task by name if no ID
          if (parsed.taskName) {
            const tasks = await api("GET", `/tasks?search=${encodeURIComponent(parsed.taskName)}`);
            if (!tasks.data?.length) return textResult(`❌ No task found matching "${parsed.taskName}"`);
            const task = tasks.data[0];
            await api("POST", `/tasks/${task.id}/complete`, body);
            return textResult(`✅ Completed task: "${task.title}"`);
          }
          return textResult("🤷 Couldn't determine which task to complete.");
        }

        case "log_interaction": {
          const rels = await api("GET", `/relationships?search=${encodeURIComponent(parsed.name)}`);
          if (!rels.data?.length) return textResult(`❌ No relationship found matching "${parsed.name}"`);
          const rel = rels.data[0];
          const body = { type: parsed.type };
          if (parsed.date) body.date = parsed.date;
          if (parsed.notes) body.notes = parsed.notes;
          await api("POST", `/relationships/${rel.id}/interactions`, body);
          return textResult(`✅ Logged ${parsed.type} with ${rel.name}.`);
        }

        case "log_visit": {
          const helpers = await api("GET", `/helpers?search=${encodeURIComponent(parsed.name)}`);
          if (!helpers.data?.length) return textResult(`❌ No helper found matching "${parsed.name}"`);
          const helper = helpers.data[0];
          const body = {};
          if (parsed.date) body.visit_date = parsed.date;
          await api("POST", `/helpers/${helper.id}/visits`, body);
          let msg = `✅ Logged visit for ${helper.name}.`;
          if (parsed.amount) {
            await api("POST", `/helpers/${helper.id}/payments`, { amount: parsed.amount });
            msg += ` Payment of $${parsed.amount} logged.`;
          }
          return textResult(msg);
        }

        case "log_payment": {
          const helpers = await api("GET", `/helpers?search=${encodeURIComponent(parsed.name)}`);
          if (!helpers.data?.length) return textResult(`❌ No helper found matching "${parsed.name}"`);
          const helper = helpers.data[0];
          await api("POST", `/helpers/${helper.id}/payments`, { amount: parsed.amount });
          return textResult(`✅ Payment of $${parsed.amount} logged for ${helper.name}.`);
        }

        case "create_task": {
          const body = { title: parsed.title };
          if (parsed.due_date) body.due_date = parsed.due_date;
          if (parsed.category) body.category = parsed.category;
          const data = await api("POST", "/tasks", body);
          return textResult(`✅ Task created: "${data.data?.title || parsed.title}"`);
        }

        default:
          return textResult(`🤷 Parsed intent "${parsed.action}" but don't know how to handle it yet.`);
      }
    } catch (err) { return errorResult(err); }
  }
);

// ── Quick capture parser (keyword/pattern matching) ──────────────────────────

function parseCapture(text) {
  const lower = text.toLowerCase().trim();

  // "called Mom", "texted John", "emailed Sarah", "visited Grandma", "video called Dad"
  const interactionMatch = lower.match(
    /^(called|texted|emailed|visited|video\s*called)\s+(.+?)(?:\s+(yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday))?$/i
  );
  if (interactionMatch) {
    const typeMap = { called: "call", texted: "text", emailed: "email", visited: "visit", "video called": "video_call", "videocalled": "video_call" };
    const rawType = interactionMatch[1].toLowerCase();
    const type = typeMap[rawType] || "call";
    return { action: "log_interaction", type, name: interactionMatch[2].trim(), date: parseFuzzyDate(interactionMatch[3]) };
  }

  // "completed laundry", "finished mowing", "done with dishes"
  const completeMatch = lower.match(/^(?:completed|finished|done with|did)\s+(.+)$/);
  if (completeMatch) {
    return { action: "complete_task", taskName: completeMatch[1].trim() };
  }

  // "Maria came today", "dog walker came Tuesday", "[name] came [date]"
  const visitMatch = lower.match(/^(.+?)\s+came\s*(yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)?/);
  if (visitMatch) {
    const rest = text.substring(visitMatch[0].length);
    const amountMatch = rest.match(/\$(\d+(?:\.\d{2})?)/);
    return {
      action: "log_visit",
      name: visitMatch[1].trim(),
      date: parseFuzzyDate(visitMatch[2]),
      amount: amountMatch ? parseFloat(amountMatch[1]) : null,
    };
  }

  // "pay Maria $150", "paid John $200"
  const payMatch = lower.match(/^(?:pay|paid)\s+(.+?)\s+\$(\d+(?:\.\d{2})?)/);
  if (payMatch) {
    return { action: "log_payment", name: payMatch[1].trim(), amount: parseFloat(payMatch[2]) };
  }

  // "add task: fix leaky faucet", "new task: buy groceries", "task: mow lawn"
  const taskMatch = lower.match(/^(?:add task|new task|task|todo|add todo)[:\s]+(.+)$/);
  if (taskMatch) {
    return { action: "create_task", title: taskMatch[1].trim() };
  }

  return null;
}

function parseFuzzyDate(word) {
  if (!word) return undefined;
  const lower = word.toLowerCase();
  const now = new Date();

  if (lower === "today") return now.toISOString().split("T")[0];
  if (lower === "yesterday") {
    now.setDate(now.getDate() - 1);
    return now.toISOString().split("T")[0];
  }

  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const idx = days.indexOf(lower);
  if (idx !== -1) {
    const today = now.getDay();
    let diff = today - idx;
    if (diff <= 0) diff += 7;
    now.setDate(now.getDate() - diff);
    return now.toISOString().split("T")[0];
  }

  return undefined;
}

// ── Graceful shutdown ────────────────────────────────────────────────────────

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

// ── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
