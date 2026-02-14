# @dwellsmith/mcp-server

MCP server for managing your Dwellsmith household from Claude Code, OpenClaw, or any MCP client.

## Setup

```bash
cd mcp-server
npm install
node setup.js
```

The setup script will prompt you to authenticate and save credentials to `~/.dwellsmith-mcp.json`.

### Authentication Options

1. **Email & password** — logs in to dwellsmith.com and stores a Sanctum token
2. **Paste token** — if you already have an API token
3. **Local dev** — custom base URL (e.g. `http://localhost:8000`) + token

## Usage

### Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "dwellsmith": {
      "command": "node",
      "args": ["/path/to/dwellsmith/mcp-server/index.js"]
    }
  }
}
```

### Run directly

```bash
node index.js
```

## Tools

| Tool | Description |
|------|-------------|
| `list_tasks` | List tasks with optional status/due/category filters |
| `create_task` | Create a new task (title, description, category, priority, due_date, recurrence) |
| `complete_task` | Mark a task as complete |
| `get_household` | Household summary dashboard |
| `list_relationships` | List tracked relationships |
| `due_contacts` | Show relationships due/overdue for contact |
| `log_interaction` | Log a call, text, email, visit, or video call |
| `list_helpers` | List household helpers |
| `log_visit` | Log a helper visit |
| `log_payment` | Log a payment to a helper |
| `list_maintenance` | List home maintenance items |
| `complete_maintenance` | Mark maintenance item as complete |
| `quick_capture` | Natural language input — e.g. "called Mom", "dog walker came Tuesday", "pay Maria $150" |

## Quick Capture Examples

- `called Mom` → logs a call interaction with Mom
- `texted John yesterday` → logs a text with John, dated yesterday
- `completed laundry` → marks the "laundry" task as done
- `Maria came today` → logs a visit for helper Maria
- `Maria came Tuesday, pay her $150` → logs visit + payment
- `pay Maria $150` → logs a $150 payment for Maria
- `add task: fix leaky faucet` → creates a new task

## Configuration

Config is stored at `~/.dwellsmith-mcp.json`:

```json
{
  "baseUrl": "https://dwellsmith.com",
  "token": "your-sanctum-token"
}
```

## Requirements

- Node.js 18+
- A Dwellsmith account with API access
