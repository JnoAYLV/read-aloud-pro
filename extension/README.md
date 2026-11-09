# Read Aloud Pro 2.0 (Chrome and Edge extension)

- **Reads aloud** highlighted text or whole pages, highlighting each word as it is spoken.
- **Finds and colours** your name and any word groups you define. Groups are saved in profiles, each with its own colour, a count, and jump buttons.
- **Keeps a dated memory** of emails, pages and pasted text from any tab.
- **Uses Claude** (your Claude Code login, or an API key) to summarize, connect the dots, and write Outlook emails, Word documents, and Teams or Slack messages. Claude follows your standard work and reference library.
- **Takes voice commands** and answers out loud.

Nothing is ever sent, posted or published by the extension. Emails open in Outlook as drafts, and you press Send.

---

## 1. Install the extension (2 minutes)

1. Put the `read-aloud-pro` folder somewhere permanent, e.g. `Documents\read-aloud-pro`.
2. Chrome: go to `chrome://extensions`. Edge: go to `edge://extensions`.
3. Turn on **Developer mode** and click **Load unpacked**, then pick the `read-aloud-pro` folder.
4. Pin it (puzzle-piece icon → pin **Read Aloud Pro**). Click the yellow speaker icon to show the panel.
5. Click ⚙ in the panel and set your name, word groups and options.

Refresh tabs that were already open. It can't run on `chrome://` pages, the Web Store, PDFs opened in the browser, or Google Docs.
For those, use **+ Paste** in the Claude tab.

## 2. Connect Claude (optional, off by default)

**Option A: your Claude Code login (no API key).**
1. Claude Code must be installed and signed in. Test it: open a terminal, type `claude`. If it says the login expired, type `/login`.
2. Open the `claude-code-bridge` folder, right-click `install-claude-code-bridge.ps1` → **Run with PowerShell**.
   This registers a small helper for your Windows user only. Undo it with `uninstall-claude-code-bridge.ps1`. Keep the folder where it is.
3. Restart Chrome. Then go to Settings → **Claude & library** → choose **Claude Code on this computer** → **Test connection**.

The helper runs Claude Code in a temporary folder with no tools except reading PDFs from your library. Your CLAUDE.md, hooks and plugins are skipped.
Usage counts against your Claude plan.

**Option B: Anthropic API key.** Paste a key from console.anthropic.com. It is billed per use (a long email summary on Sonnet costs about a cent).

The memory items you use and your switched-on library documents are sent to Claude. Check your company's policy for work material.

## 3. Reference library

Settings → **Claude & library**. Four guides are built in, and you can switch each on or off:
- Email writing skills
- House style
- Operations management knowledge
- Aviation and air cargo ground operations

**Upload your current standard work** (.docx, .pdf, .txt, .md, .csv, .html) and tag it *Standard work*. Claude follows it and names it when it relies on it.
**Make editable copy** turns a built-in guide into one you can change. Use it to add your company terms to the House style.
Keep the library lean: everything switched on is sent with every request. The page shows the total size.

## 4. Highlighting: profiles, groups and colours

Settings → **Highlighting**.
- A profile is a saved set of word groups, e.g. "Operations", "Safety audit" or "Email triage". Create, duplicate, rename or delete profiles there.
- Each group has a name, a colour (click the swatch) and a term list. Use **+ Add word group** for more.
- `*` matches any ending (`injur*`), and plurals match automatically.
- Switch profiles and change **Your name** right in the panel's **Find** tab.
- **Scan this page** shows counts per group. ‹ › jump between hits, each hit shows the section it is under, and **▶ read from here** starts reading there.

## 5. Memory

In the panel's **Claude** tab:
- **+ Highlighted**, **+ This page** and **+ Paste** add items. Right-click menus and voice commands add them too.
- Every item is saved with its date and time and grouped under Today, Yesterday and so on.
- **Today's items are used by default.** Older items are not sent, but Claude sees their titles and dates. If they look related, it tells you which ones to tick.
- Tick or untick any item to include or exclude it. ✕ removes it.

## 6. Writing

Choose a format and press **Write**. Say what you want in the box ("Reply to Mike with the 3 safety items and next steps").

| Format | You get |
|---|---|
| Outlook email | **Open in Outlook** opens a new unsent draft with subject and formatting; you review and send |
| Word document | **Open in Word** opens a .docx with real headings, bullets and numbering |
| Teams / Slack message | Short chat text; **Copy**, then paste it in. Nothing is posted for you |
| Auto | Claude picks the format, or asks you with buttons when it's unclear |

Also: **Summarize**, **Connect the dots** (patterns, contradictions, standard-work gaps and open questions across your memory) and **List issues** (safety and controllable failures with quotes).

**Where files go** (Settings → Reading & notes): a folder inside Downloads, or **any folder such as Google Drive** (`C:\Users\you\My Drive\Read Aloud`).
Saving to any folder needs the helper from step 2. Drive for desktop uploads the files on its own.

## 7. Voice commands

Click 🎤 in the panel or press **Alt+Shift+V**. Chrome asks once per site for the microphone. Recognition is free and runs through Google's speech service.

| Say | Does |
|---|---|
| stop · pause · continue · start over | control reading |
| read last sentence · read last paragraph · repeat that | re-read what you just heard, with highlighting |
| go back · skip · faster · slower | move by sentence, change speed |
| read this page · read highlighted | start reading |
| add last paragraph to memory · add last sentence to memory · add highlighted to memory · add this page / add all to memory | save to memory with date and time |
| scan | find your highlight words and say how many |
| summarize · connect the dots · list issues | Claude works on your memory; the summary is read aloud |
| write an email to Mike about … · write a document about … · Teams message about … · Slack message about … | draft in that format |
| read it · open in Outlook · open in Word · save it · copy it | act on the latest draft |
| Claude, … (e.g. "Claude, what were the safety issues?") | ask Claude; the answer is spoken. Speech without the word "Claude" is never sent to Claude, so nearby conversation is ignored |
| help · stop listening | hear the list · turn the mic off |

While it is reading, the mic ignores speech that matches the words being read, so its own voice doesn't trigger commands. Short commands like "stop" always work.

## 8. Voices and speaker

- **Free:** the Windows voices (David, Mark, Zira) give exact word highlighting. In **Microsoft Edge** you also get free natural voices (Aria, Guy, Jenny…).
  The ✓ mark means exact highlighting; ≈ means the highlight is timed by estimate.
- **ElevenLabs (optional):** Settings → Reading & notes. Paste your ElevenLabs key, then pick a voice (yours or the library's).
  - It uses characters from your ElevenLabs plan; there is no one-time purchase. The page shows how much of your monthly allowance is used.
  - Flash v2.5 uses half the characters.
  - Never clone a voice without the person's consent.
- **Speaker:** choosing an output speaker works with ElevenLabs voices (Settings → Speaker → List my speakers). Built-in voices always use the Windows default.
  To move Chrome's sound: Windows Settings → System → Sound → Volume mixer → Chrome → Output device.

## 9. Shortcuts

| Keys | Action |
|---|---|
| Alt+Shift+R | Read highlighted text |
| Alt+Shift+P | Read the page |
| Alt+Shift+Space | Pause / resume |
| Alt+Shift+V | Voice commands on / off |
| Esc | Stop |
| Alt+click a word | Read from that word |

Change the shortcuts at `chrome://extensions/shortcuts`.

## Why the highlight stays in step (the bug in the earlier app)

Simple readers hand all the text to the voice at once and move the highlight only when the voice reports a word. Many voices never report words, and long text drifts or cuts out. This extension:
1. reads one sentence at a time;
2. follows the voice's word reports when the voice sends them;
3. otherwise estimates the position from a speed it learned for that voice;
4. resumes from the exact word;
5. never edits the page itself.

## Files

- **Reader, finder, panel, voice:** `content.js`, `content.css`
- **Menus, hotkeys, Claude, ElevenLabs, saving:** `background.js`
- **Settings:** `options.html`, `options.js`
- **Defaults:** `defaults.js`
- **Word upload reader:** `docx.js`
- **Outlook and Word builders:** `docgen.js`
- **Built-in guides:** `knowledge/`
- **Claude Code and folder-saving helper:** `claude-code-bridge/`
- **Test pages used during the build:** `test/`
