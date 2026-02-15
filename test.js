#!/usr/bin/env node

/**
 * Unit tests for Dwellsmith MCP server utilities.
 * Run with: node test.js
 *
 * Tests validation schemas, parse helpers, and error formatting
 * without requiring a live API connection.
 */

import { z } from "zod";
import assert from "node:assert/strict";

// ── Re-create schemas and helpers from index.js for testing ──────────────────

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format").refine((s) => {
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime());
}, "Invalid date — check month and day values");

const idSchema = z.number().int().positive("ID must be a positive integer");

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

function parseCapture(text) {
  const lower = text.toLowerCase().trim();
  const interactionMatch = lower.match(
    /^(called|texted|emailed|visited|video\s*called)\s+(.+?)(?:\s+(yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday))?$/i
  );
  if (interactionMatch) {
    const typeMap = { called: "call", texted: "text", emailed: "email", visited: "visit", "video called": "video_call", "videocalled": "video_call" };
    const rawType = interactionMatch[1].toLowerCase();
    const type = typeMap[rawType] || "call";
    return { action: "log_interaction", type, name: interactionMatch[2].trim(), date: parseFuzzyDate(interactionMatch[3]) };
  }
  const completeMatch = lower.match(/^(?:completed|finished|done with|did)\s+(.+)$/);
  if (completeMatch) {
    return { action: "complete_task", taskName: completeMatch[1].trim() };
  }
  const visitMatch = lower.match(/^(.+?)\s+came\s*(yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)?/);
  if (visitMatch) {
    const rest = text.substring(visitMatch[0].length);
    const amountMatch = rest.match(/\$(\d+(?:\.\d{2})?)/);
    return { action: "log_visit", name: visitMatch[1].trim(), date: parseFuzzyDate(visitMatch[2]), amount: amountMatch ? parseFloat(amountMatch[1]) : null };
  }
  const payMatch = lower.match(/^(?:pay|paid)\s+(.+?)\s+\$(\d+(?:\.\d{2})?)/);
  if (payMatch) {
    return { action: "log_payment", name: payMatch[1].trim(), amount: parseFloat(payMatch[2]) };
  }
  const taskMatch = lower.match(/^(?:add task|new task|task|todo|add todo)[:\s]+(.+)$/);
  if (taskMatch) {
    return { action: "create_task", title: taskMatch[1].trim() };
  }
  return null;
}

// ── Tests ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

console.log("\n🧪 Date Schema Validation\n");

test("accepts valid date", () => {
  assert.equal(dateSchema.parse("2025-01-15"), "2025-01-15");
});

test("rejects bad format", () => {
  assert.throws(() => dateSchema.parse("01-15-2025"));
});

test("rejects invalid date values", () => {
  assert.throws(() => dateSchema.parse("2025-13-01"));
});

test("rejects non-date string", () => {
  assert.throws(() => dateSchema.parse("tomorrow"));
});

console.log("\n🧪 ID Schema Validation\n");

test("accepts positive integer", () => {
  assert.equal(idSchema.parse(42), 42);
});

test("rejects zero", () => {
  assert.throws(() => idSchema.parse(0));
});

test("rejects negative", () => {
  assert.throws(() => idSchema.parse(-5));
});

test("rejects float", () => {
  assert.throws(() => idSchema.parse(3.5));
});

console.log("\n🧪 Fuzzy Date Parser\n");

test("returns undefined for null", () => {
  assert.equal(parseFuzzyDate(null), undefined);
});

test("parses today", () => {
  const result = parseFuzzyDate("today");
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test("parses yesterday", () => {
  const result = parseFuzzyDate("yesterday");
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(result, parseFuzzyDate("today"));
});

test("parses day of week", () => {
  const result = parseFuzzyDate("monday");
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test("returns undefined for unknown word", () => {
  assert.equal(parseFuzzyDate("next week"), undefined);
});

console.log("\n🧪 Quick Capture Parser\n");

test("parses 'called Mom'", () => {
  const r = parseCapture("called Mom");
  assert.equal(r.action, "log_interaction");
  assert.equal(r.type, "call");
  assert.equal(r.name, "mom");
});

test("parses 'texted John yesterday'", () => {
  const r = parseCapture("texted John yesterday");
  assert.equal(r.action, "log_interaction");
  assert.equal(r.type, "text");
  assert.equal(r.name, "john");
  assert.ok(r.date);
});

test("parses 'completed laundry'", () => {
  const r = parseCapture("completed laundry");
  assert.equal(r.action, "complete_task");
  assert.equal(r.taskName, "laundry");
});

test("parses 'Maria came today'", () => {
  const r = parseCapture("Maria came today");
  assert.equal(r.action, "log_visit");
  assert.equal(r.name, "maria");
});

test("parses 'Maria came Tuesday, pay her $150'", () => {
  const r = parseCapture("Maria came Tuesday, pay her $150");
  assert.equal(r.action, "log_visit");
  assert.equal(r.amount, 150);
});

test("parses 'pay Maria $150'", () => {
  const r = parseCapture("pay Maria $150");
  assert.equal(r.action, "log_payment");
  assert.equal(r.name, "maria");
  assert.equal(r.amount, 150);
});

test("parses 'add task: fix leaky faucet'", () => {
  const r = parseCapture("add task: fix leaky faucet");
  assert.equal(r.action, "create_task");
  assert.equal(r.title, "fix leaky faucet");
});

test("returns null for unparseable text", () => {
  assert.equal(parseCapture("hello world"), null);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
