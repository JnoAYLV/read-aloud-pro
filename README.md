# Read Aloud Pro

A Windows app that reads text from **any program** aloud (Outlook, Word, PDFs, Teams, web pages), highlighting each word as it's spoken in a natural free voice.

It also:
- marks your name and any word groups you choose;
- keeps a dated memory of what you collect;
- uses Claude (your Claude Code login) to summarize and to write Outlook emails, Word documents, and Teams or Slack messages.

Nothing is ever sent or posted for you. Emails open in Outlook as drafts, and you press Send.

**Folders**
- `desktop\`: the app. The installer is `desktop\dist\Read Aloud Pro Setup 1.0.0.exe`.
- `extension\`: the earlier Chrome/Edge extension version. It only works inside the browser.

---

**The full manual** is `MANUAL.md` in this folder, and inside the app: the **?** button in the panel, **Manual** in the tray menu, or say "open the manual".

## Install

1. Run **Read Aloud Pro Setup 1.0.0.exe**. Windows may say "Windows protected your PC" because the app isn't signed with a paid certificate. Click **More info**, then **Run anyway**.
2. Start **Read Aloud Pro** from the desktop shortcut. A yellow speaker icon appears in the system tray, by the clock.
3. **First start only:** the natural voice downloads once (about 330 MB, free, from Hugging Face). After that it works offline.
4. Click **⚙** in the panel and set:
   - **Highlighting → Your name**: e.g. `Sam Taylor, Sam`, then **Save**.
   - **Claude & library → Claude Code on this computer**, then **Test connection**.
     - This needs Claude Code installed and signed in. Check by opening a terminal and typing `claude`. If it says the login expired, type `/login`.
     - Usage counts against your own Claude plan.
   - Optional: **Reading & notes → Speaker** to pick which speaker the voice plays on.

## Use it anywhere

| Keys (work in any program) | What happens |
|---|---|
| Highlight text, then **Ctrl+Alt+R** | The text appears in the reader and is read aloud with each word highlighted |
| **Ctrl+Alt+O** | Reads the text on screen, even where it can't be highlighted (scanned PDFs, images, locked windows), using Windows' built-in text recognition |
| Highlight text, then **Ctrl+Alt+M** | Adds it to memory, saved with the date, time and window name |
| **Ctrl+Alt+V** | Push-to-talk: say a command, then pause. Speech is recognized on this PC |
| **Ctrl+Alt+Space** | Pause / resume |
| **Ctrl+Alt+S** | Stop |

In the reader:
- **Open file** reads Word (.docx), PDF, email (.eml) and text files.
- **Paste** reads whatever is on the clipboard.
- **Alt+click** any word to start reading there.

Closing the window keeps the app running in the tray. To exit fully: right-click the tray icon → **Quit**.

## The panel (right side)

- **Read**
  - Voice: 28 natural voices free on this PC, plus the old Windows voices.
  - Speed, play/pause, skip by sentence.
- **Find**
  - Your name and word groups (Safety, Controllable failures, Actions & deadlines, and any you add), each in its own color.
  - Counts, ‹ › to jump between hits, the section each hit is under, and "▶ read from here".
  - Profiles keep different sets of groups. Edit groups and colors in ⚙ → Highlighting.
- **Claude**
  - **Memory:** items are dated. Today's are used by default. For older ones, Claude tells you which look related so you can tick them.
  - **Write**, choosing a format:
    - **Outlook email** → **Open in Outlook** opens a real draft window. It never sends.
    - **Word document** → **Open in Word**.
    - **Teams / Slack** → **Copy**.
    - **Auto** asks you when it's unclear.
  - **Summarize**, **Connect the dots** (patterns, contradictions and gaps against standard work), **List issues**. These come back as plain spoken English, with no symbols, so they read like an assistant briefing you. **▶ Read aloud** and **■ Stop** sit at the top of the answer.
  - **Research**: highlight a word or passage you don't follow, then press Research (or say "explain …"). Claude explains it using the email, your memory items, your library and your Obsidian notes, and searches the web for terms that are still unclear. It says which parts came from the web. Web searches use only general terms, never names or internal details.
  - **Obsidian vault** (⚙ → Claude & library, off until you tick it): pick a vault folder. When Claude writes, researches or answers, the app finds the few notes that match and sends them along; the answer lists which notes were used. Summaries never use the vault. Leave out vaults or folders with private notes.
  - **Reference library** (⚙ → Claude & library):
    - 4 built-in guides: email writing, house style, operations, aviation ground ops.
    - Upload your **standard work** (Word, PDF, text). Claude follows it and names it when it relies on it.

**Where files go:** `Documents\Read Aloud Pro Notes` by default. Change it in ⚙ → Reading & notes. A Google Drive or OneDrive folder works too: files saved there upload on their own.

## Voice commands (Ctrl+Alt+V, then speak)

- **Reading:** stop · pause · continue · start over · read last sentence · read last paragraph · go back · skip · faster · slower · read this page
- **Memory:** add last paragraph to memory · add last sentence to memory · add this page to memory
- **Claude:**
  - summarize · connect the dots · list issues
  - write an email to Mike about … · write a document about … · Teams message about …
  - read it · open in Outlook · open in Word · save it · copy it
  - **Claude, …** to ask a question and hear the answer. Questions must start with "Claude".
- **help**: hear the full list.

## Known limits

- The first start needs internet for the one-time voice download, plus about 150 MB more the first time you use voice commands.
- **Open in Outlook** needs **classic Outlook**. The new Outlook app can't be automated; then the draft opens as an email file instead.
- The installer isn't code-signed, so Windows shows a warning the first time.
- Word highlighting with the natural voices is timed against each spoken sentence, so it can be off by a word or so within a sentence. It never drifts across sentences.
- The hotkeys need an active desktop: they don't work while the PC is locked or the remote session is disconnected.

## For whoever maintains it

- **Run from source:** `cd desktop`, `npm install`, `npm start`.
- **Build the installer:** `npm run dist`.
- **Code:**
  - `src\main.js`: tray, hotkeys, grabbing text from other programs, screen reading
  - `src\core.js`: Claude, library, saving, Outlook
  - `src\ai-worker.js`: Kokoro voice and Whisper speech recognition
  - `renderer\`: reader window and settings (shared with the extension)
- After editing `renderer\options.html`, run `node tools\make-settings.js`.
- The in-app manual is built from `MANUAL.md` (one level up): after editing it, run `node tools\make-manual.js`.
