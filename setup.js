#!/usr/bin/env node

import { createInterface } from "node:readline";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = join(homedir(), ".dwellsmith-mcp.json");
const DEFAULT_URL = "https://dwellsmith.com";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log("\n🏠 Dwellsmith MCP Server Setup\n");
  console.log("Choose authentication method:\n");
  console.log("  1. Login with email & password");
  console.log("  2. Paste an existing API token");
  console.log("  3. Local development (custom URL + token)\n");

  const choice = await ask("Enter choice (1/2/3): ");

  let baseUrl = DEFAULT_URL;
  let token;

  switch (choice.trim()) {
    case "1": {
      const email = await ask("Email: ");
      const password = await ask("Password: ");
      baseUrl = DEFAULT_URL;

      console.log("\nAuthenticating...");
      try {
        const res = await fetch(`${baseUrl}/api/v1/auth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: email.trim(), password, device_name: "mcp-server" }),
          signal: AbortSignal.timeout(15000),
        });
        const data = await res.json();
        if (!res.ok) {
          console.error(`\n❌ Login failed: ${data.message || res.status}`);
          process.exit(1);
        }
        token = data.token;
        console.log("✅ Login successful!");
      } catch (err) {
        console.error(`\n❌ Login failed: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case "2": {
      token = await ask("Paste your API token: ");
      token = token.trim();
      break;
    }

    case "3": {
      baseUrl = await ask(`Base URL (default: http://localhost:8000): `);
      baseUrl = baseUrl.trim() || "http://localhost:8000";
      token = await ask("API token: ");
      token = token.trim();
      break;
    }

    default:
      console.error("Invalid choice.");
      process.exit(1);
  }

  // Verify token
  console.log("\nVerifying token...");
  try {
    const res = await fetch(`${baseUrl}/api/v1/household`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error(`\n❌ Token verification failed: ${data.message || res.status}`);
      console.error("Token was NOT saved. Please try again.");
      process.exit(1);
    }
    console.log("✅ Token verified!");
  } catch (err) {
    console.error(`\n⚠️  Could not verify token (${err.message}).`);
    const save = await ask("Save anyway? (y/N): ");
    if (save.trim().toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(1);
    }
  }

  // Save config
  const config = { baseUrl, token };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  console.log(`\n✅ Config saved to ${CONFIG_PATH}`);
  console.log("\nYou can now use the MCP server with Claude Code or OpenClaw.");

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
