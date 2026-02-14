# Dwellsmith for Claude

Dwellsmith lets you manage your household just by talking to Claude. Tasks, contacts, helpers, home maintenance — just say what you need in plain English, and Claude takes care of the rest. No apps to switch between, no forms to fill out.

## What can you do with it?

Here are real things you can say to Claude once Dwellsmith is set up:

**📋 Tasks & to-dos**

- "What's on my plate today?"
- "Add a task: fix the leaky faucet by Friday"
- "Mark the laundry task as done"
- "What tasks are overdue?"

**👋 Staying in touch**

- "I called Mom yesterday"
- "Who haven't I talked to in a while?"
- "I had coffee with Sarah on Tuesday"
- "Log a video call with Dad — we talked for about an hour"

**🏠 Home maintenance**

- "What home maintenance is coming up?"
- "Mark the gutter cleaning done"
- "Is anything overdue on the house?"

**🤝 Helpers (cleaners, dog walkers, etc.)**

- "Did the dog walker come this week?"
- "Maria came today — pay her $150"
- "Log that the cleaners came on Monday"

**✨ Or just ask for the big picture**

- "What's my household look like right now?"

You don't need to memorize any special commands. Just talk to Claude the way you'd talk to a friend, and Dwellsmith figures out what you mean.


## Getting started

You'll need a Dwellsmith account and either **Claude Code** or **Claude Desktop** already installed. This takes about 5 minutes.

**Step 1: Open Terminal**

On your Mac, press **⌘ Space** (Command + Space) to open Spotlight, type **Terminal**, and hit Enter. A window with a text prompt will appear — that's where you'll paste the commands below.

**Step 2: Download and install Dwellsmith for Claude**

Copy and paste this entire block into Terminal, then press Enter:

```bash
cd ~/Documents
git clone https://github.com/your-org/dwellsmith.git
cd dwellsmith/mcp-server
npm install
```

This downloads the Dwellsmith connection and installs everything it needs. You'll see some text scroll by — that's normal.

> If you already have the dwellsmith repo cloned, just `cd` into the `mcp-server` folder and run `npm install`.

**Step 3: Run setup**

Still in Terminal, type:

```bash
node setup.js
```

It will ask for your Dwellsmith email and password. Type them in and press Enter. (Your password won't show as you type — that's a security feature, not a bug!)

This connects Claude to your Dwellsmith account.

**Step 4: Tell Claude about Dwellsmith**

You need to add a small config snippet so Claude knows how to find Dwellsmith.

For **Claude Code**, open (or create) the file `~/.claude.json` and add:

```json
{
  "mcpServers": {
    "dwellsmith": {
      "command": "node",
      "args": ["/Users/YOURNAME/Documents/dwellsmith/mcp-server/index.js"]
    }
  }
}
```

Replace `YOURNAME` with your Mac username (the name of your home folder).

For **Claude Desktop**, go to **Settings → Developer → Edit Config** and add the same block under `mcpServers`.

**Step 5: Restart Claude**

Quit Claude completely and reopen it. This lets it pick up the new connection.

**Step 6: Try it out!**

Say to Claude:

> "What's my household look like?"

If you see a summary of your tasks, contacts, and maintenance — you're all set! 🎉


## Troubleshooting

**"It says 'unauthorized' or 'authentication failed'"**

Your login session probably expired. Open Terminal, go back to the mcp-server folder, and run `node setup.js` again to log in fresh. Then restart Claude.

**"Claude doesn't seem to know about Dwellsmith"**

Double-check that your config file has the right path to `index.js`. The most common mistake is a typo in your username or folder path. Also make sure you restarted Claude after adding the config.

**"It says 'no config found'"**

The setup step didn't finish. Run `node setup.js` again from the mcp-server folder and make sure you complete the login.

**"It's just slow or times out"**

This can happen if your internet connection is spotty or Dwellsmith's servers are briefly busy. Wait a moment and try again.


## Privacy

Your data stays between you and Dwellsmith. Claude connects to your Dwellsmith account using the credentials you set up — it reads and writes to your household, and nowhere else. No data is shared with third parties. It's just like using the Dwellsmith app, except you're talking to Claude instead of tapping buttons.
