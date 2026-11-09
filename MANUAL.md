# Read Aloud Pro Manual

Version 1 · November 2026

## What Read Aloud Pro is for

Read Aloud Pro helps you take in long or dense work text faster and more completely, then act on it. It reads any text on your PC aloud in a natural voice while highlighting each word, marks the things that matter to you, and hands the material to Claude to explain, summarize or draft a reply.

It was built for operations work, where the important line in an email is easy to miss: your name, a safety issue, a controllable failure, a deadline. Six ideas shape every feature:

- **Listen and look at the same time.** The highlight follows the voice word by word, so your eyes stay on the place you are hearing. This is what keeps your attention on long text.
- **Works where your text already is.** Outlook, Word, PDFs, Teams, web pages, scanned documents. You do not copy and paste; you highlight and press a key.
- **Nothing important slips past.** Your name and your chosen word groups (safety, controllable failures, deadlines) are coloured and counted, with a jump list.
- **Claude understands it with you, in plain words.** Summaries and explanations are written to be heard, like an assistant briefing you, with no symbols.
- **You stay in control of anything that leaves your hands.** The app never sends an email or posts a message. Emails open as Outlook drafts; you press Send.
- **Everything new starts switched off.** Claude, the Obsidian vault and automatic scanning stay off until you switch them on.

The voice and speech recognition run on your own PC and cost nothing. Claude uses your own Claude Code login (your Claude plan) or an API key.

## Install and first-time setup

Setup takes about ten minutes, most of it a one-time voice download. Do the steps in order; each one says what success looks like.

1. **Run the installer.** Double-click **Read Aloud Pro Setup.exe**. Windows may show "Windows protected your PC" because the app is not signed with a paid certificate. Click **More info**, then **Run anyway**, then accept the default choices.
   - Success: a **Read Aloud Pro** shortcut on your desktop.
2. **Start the app.** Open the shortcut. A yellow speaker icon appears in the system tray, by the clock, and the reader window opens with the panel on its right.
   - Closing the window keeps the app running in the tray. To quit fully, right-click the tray icon, then **Quit**.
3. **Let the voice download (first start only).** The natural voice is about 330 MB from Hugging Face. The first read can take a minute; after that it works offline. Voice commands download about 150 MB more the first time you use them.
4. **Set your name.** Click **⚙**, then **Highlighting**. In the name group, type your name in the box under "Your name", with commas between the versions people use (for example `Sam Taylor, Taylor, Sam`). Click **Save**.
   - Why: your name is the first thing the app looks for in every email.
5. **Pick your voice.** **⚙ → Reading & notes → Voice**. Choose a natural voice and click **Play a test sentence**.
6. **Pick your microphone.** In the same tab, under **Microphone**, choose your real mic and click **Test: speak for 3 seconds**. Success: the green bar moves and it says "Heard you".
   - Virtual mics such as SteelSeries Sonar only work when that program is passing your real mic through.
7. **Turn on Claude.** Open the panel's **Claude** tab and click **Turn on: use my Claude Code login**. It checks your login in 10 to 30 seconds and switches on.
   - This needs Claude Code installed and signed in. If it says the login expired, open a terminal, type `claude`, then `/login`.
8. **Optional: add your standard work and connect a vault.** See *Reference library, standard work and Obsidian vault* below.

Test it: open an email in Outlook, highlight a sentence, and press **Ctrl+Alt+R**. The sentence appears in the reader and is read aloud, each word lighting up as it is spoken.

## The reader window and panel at a glance

The reader window shows the text being read on the left and the panel on the right. The panel has three tabs: **Read** to listen, **Find** to spot what matters, and **Claude** to understand and write.

| Area | Where | What it is for |
| --- | --- | --- |
| Open file | Top bar | Load a Word, PDF, email (.eml), web page or text file to read |
| Paste | Top bar | Read whatever is on your clipboard |
| Read screen | Top bar | Pick a whole screen or a single window and read the text in it, even where text cannot be highlighted |
| Reading area | Left | The text, with the spoken sentence shaded and the spoken word highlighted |
| Read tab | Panel | Start, pause, skip, stop; choose voice and speed |
| Find tab | Panel | Your name and word groups, coloured and counted, with a jump list |
| Claude tab | Panel | Memory, Summarize, Connect the dots, List issues, Research, Write |
| 🎤 | Panel header | Push-to-talk for voice commands (same as Ctrl+Alt+V) |
| ? | Panel header | This manual |
| ⚙ | Panel header | Settings |
| Tray icon | By the clock | Show the reader, read highlighted text, read the screen, Manual, Settings, Quit |

The app keeps running in the tray when you close the window, so the shortcut keys work in every program all day.

**Help inside the app:**

- **Walkthroughs.** The first time you open each panel tab (Read, Find, Claude) and each Settings tab, a short walkthrough points at each control in turn and says what it is for. Use **Next**, **Back** and **Done**, or **Skip all walkthroughs**. The Claude tab has a second walkthrough the first time Claude is switched on. To see them again: **⚙ → Show the walkthroughs again**.
- **i buttons.** Every option in Settings has an **i** next to it. Click it for a plain explanation and a link to the right part of this manual.
- **This manual.** The **?** button in the panel header, **Manual** in the tray menu, **? Manual** in Settings, or say "open the manual".

## Reading aloud

There are five ways to get text into the reader. Use the one that matches where the text is.

| Where the text is | What to do | Why this way |
| --- | --- | --- |
| Any program you can highlight in (Outlook, Word, PDF viewer, Teams, browser) | Highlight it, then press **Ctrl+Alt+R** | Fastest. The app copies the highlight, puts your clipboard back as it was, and starts reading |
| A file on your PC | **Open file** in the reader | Reads Word (.docx), PDF, email (.eml), web pages and text files whole, so you can jump around in them |
| Something already copied | **Paste** in the reader | For text from places that block shortcuts |
| Text you cannot highlight (scanned PDF, image, locked window, remote desktop) | **Read screen**, then pick a screen or a window | Windows' own text recognition reads what is shown. Single windows are read even when covered |
| The window in front, quickly | **Ctrl+Alt+O** | Same as Read screen without the picker |

The **Read highlighted** button in the panel works like Ctrl+Alt+R: if nothing is highlighted in the reader, it fetches the highlight from the program you were in just before.

**While it reads.** The sentence being read is shaded and the word being spoken is highlighted. Use these controls:

- **⏮ / ⏭** go back or forward one sentence. Use them to replay a sentence you missed instead of starting over.
- **⏯** pauses and resumes exactly where you stopped (Ctrl+Alt+Space from any program).
- **⏹** stops (Esc in the reader, Ctrl+Alt+S anywhere).
- **Alt+click** any word to start reading from it. This is the quickest way to re-hear one paragraph.
- **Speed** runs from 0.5x to 3x. Most people take in work email well at 1.2x to 1.5x.
- **Scroll to follow along** keeps the spoken line on screen in long documents.

**Voices.** The natural voices (Kokoro) are free, run on your PC and keep everything private. Pick one in the panel or in Settings. The highlight is timed against each spoken sentence, so it can be a word ahead or behind inside a sentence, but it never drifts across sentences. The Windows voices sound robotic but highlight each word exactly; use them if exact word tracking matters more than sound.

**Speaker.** **⚙ → Reading & notes → Speaker** sends the natural voice to a chosen speaker or headset, so you can listen privately while calls use your main speaker.

## Find: your name and the words that matter

The Find tab colours every mention of your name and your chosen word groups, counts them, and lets you jump to each one. Its purpose is that you never miss the line that is about you, about safety, or about something you own.

**How to use it.** Load the text, open **Find**, and click **Scan this page**. Each group shows its colour, its count, and its hits. Use **‹ ›** to step through hits; each hit shows the section it sits under, and **▶ read from here** reads from that spot. **Clear** removes the colours.

**The groups that come with the app:**

| Group | Intent |
| --- | --- |
| Your name | Find every place you are named, asked or tagged |
| Safety | Injuries, near misses, hazards, damage, anything that must not wait |
| Controllable failures | Delays and misses the team could have prevented: staffing, late builds, missed handoffs |
| Actions & deadlines | Asks, owners and due dates, so you see what you are expected to do |

**Make it yours.** In **⚙ → Highlighting**:

- **Add a group** with **+ Add word group**, give it a name, a colour and its terms.
- **Terms** are separated by commas. Plurals match on their own. A `*` at the end matches any ending: `injur*` finds injury, injured and injuries.
- **Colours** start as defaults; click a colour to change it. Keep safety a colour you will never ignore.
- **Profiles** are saved sets of groups for different jobs, for example *Email triage* and *Safety audit*. Use **New**, **Duplicate**, **Rename** and **Delete**, then switch profiles from the Find tab. A new profile keeps your name.
- **Your name** can also be changed directly in the Find tab.
- **Scan every page automatically** is off by default. Turn it on if you want every new text coloured as soon as it loads.

Click **Save** after changing groups or profiles.

## Memory: collecting what Claude should work from

Memory is the pile of material you gather before asking Claude to summarize, connect or write. Each item is saved with its date, time and the window it came from. Its purpose is to let Claude work across several emails, documents and pages at once, the way you would when building a reply or a report.

**Adding items:**

- **Ctrl+Alt+M** in any program adds the highlighted text.
- In the Claude tab: **+ Highlighted** (text highlighted in the reader), **+ This page** (everything in the reader), **+ Paste** (text from anywhere, with an optional title).
- By voice: "add last paragraph to memory", "add last sentence to memory", "add this page to memory".

**How dates work.** Today's items are ticked and used automatically. Items from earlier days are not sent by default, so yesterday's thread does not leak into today's answer. When older items look related, Claude ends its answer with "Related older items you may want me to include" and names them; tick the ones you want and run it again. A tick or untick lasts for the day you made it; the next day every item goes back to the default.

If memory is empty, Claude works from the text highlighted in the reader, or else the whole page in the reader.

**Limits.** Each item keeps up to 200,000 characters (about 60 to 80 pages). Anything longer is cut, and the app says so plainly. Add very long documents in parts. **Clear all** empties memory; it cannot be undone.

## Claude: understand, research and write

The Claude tab turns what you have read into understanding and into finished drafts. Claude works only from your memory items, the reference library, the matching Obsidian notes and, for Research, the web. It does not invent names, numbers or dates; anything it cannot know is left in \[brackets\] for you to fill.

**Turning it on.** Claude is off until you switch it on: click **Turn on: use my Claude Code login** in the Claude tab, or choose a connection in **⚙ → Claude & library**. A status line under the buttons always says what Claude is using (for example "using 3 memory items").

**The request box** ("What do you want?") steers every button. Be specific about audience, length and tone: *"Reply to Mike with the 3 safety items and next steps, short."*

| Button | What you get | When to use it |
| --- | --- | --- |
| Summarize | A spoken-style briefing: the bottom line first, then who is asking what, what it means for you, what to do by when | You need to grasp a long email or thread quickly. Summaries stick to the source and never use the Obsidian vault |
| Connect the dots | Repeated issues, cause and effect, contradictions between sources, gaps against standard work, open questions, next actions with \[owner\] and \[date\] | Several emails or reports about the same operation |
| List issues | Every safety issue, then every controllable failure, each with a short quote so you can find it | Before a call, a review or an escalation |
| Research | A plain explanation of what you highlighted, using your documents, notes and the web, saying which parts came from where | A term, acronym, regulation or reference you do not fully follow |
| Write | A draft in the format you choose | Replies, updates, memos, procedures, chat messages |

**Research, done well.** Highlight the exact phrase you do not understand, then press **Research**. Claude uses the rest of the text as background. You can also type a question in the request box instead of highlighting, or say "explain …". For web searches Claude is instructed to use only general terms, never people's names, gateway codes or internal numbers.

**Write and its formats.** Choose the format next to **Write**:

- **Outlook email**: a subject line, then the body. **Open in Outlook** opens a real draft window, with your signature, that you review and send yourself. Classic Outlook is needed; with the new Outlook the draft opens as an email file instead.
- **Word document**: a titled document with headings. **Open in Word** saves and opens it.
- **Teams** or **Slack message**: short and scannable. **Copy**, then paste it into the chat. Nothing is posted for you.
- **Auto**: Claude picks, or asks you with buttons if it is unclear.

**After an answer.** **▶ Read aloud** and **■ Stop** sit at the top of the answer; the words light up as they are read. Below it: **Copy**, **Save** (to your notes folder), and the Open buttons. **Save highlighted text as a note** keeps a clip as a file without asking Claude.

**Speed and quality.** Claude Code answers usually take 10 to 60 seconds; Research takes longer when it searches the web. In **⚙ → Claude & library** you can choose Haiku (fastest), Sonnet (recommended) or Opus (best). Usage counts against your own Claude plan.

## Reference library, standard work and Obsidian vault

The library is what Claude must follow; the vault is where Claude looks for background. Both make answers sound like your operation instead of generic advice.

**Reference library** (**⚙ → Claude & library → Reference library**). Claude reads every switched-on library document before it writes, every time.

- **Built-in guides** (on by default): email writing, house style, operations, and aviation ground operations. House style includes rules such as saying "gateways" not "sites" and never naming a person as the cause of a failure.
- **Upload your own:** choose **Add as Standard work** or **Reference**, then pick files (.docx, .pdf, .txt, .md, .csv, .html), or use **Paste text as a document**.
- **Standard work** ranks first. Claude follows it and names it when it relies on it, and **Connect the dots** points out gaps between what happened and the standard work.
- **Keep it current and lean.** Replace old versions of a standard work document instead of adding new ones beside them; switch off documents that do not apply. The library holds up to 250,000 characters of text; anything over is left out and named in the answer.

**Obsidian vault** (optional, off until you choose one). When Claude writes, researches, answers a question or connects the dots, the app searches the chosen vault on your PC, picks the few notes that best match the request, and sends them along. Each answer lists the notes it used. **Summaries never use the vault**, so they stay true to the email.

Three ways to choose the vault:

1. **Claude tab:** the **Notes from Obsidian** list shows every vault Obsidian knows on this PC. Pick one, or **Off**.
2. **By voice:** "connect my Work vault", "Claude, use the Creator vault", or "disconnect the vault".
3. **Settings:** **⚙ → Claude & library → Obsidian vault**. Pick a vault or **Choose folder…**, tick the box, list folders to skip (for example `Templates, Attachments`), and click **Test** to see how many notes it can search.

Pick the vault that fits the work in front of you. Leave out vaults or folders with private notes such as health, money or family; only the notes that match a request are sent, but you decide what can match.

## Voice commands

Press **Ctrl+Alt+V** (or the 🎤 button), say one command, then pause. The app listens until about a second of quiet, recognises your words on your PC, and acts. Reading pauses while you speak and resumes after. Say **"help"** to hear every command.

| Say | What happens |
| --- | --- |
| stop · pause · continue | Stop, pause or resume reading |
| start over | Read the last text again from the top |
| read last sentence · repeat that | Replay the sentence just read |
| read last paragraph | Replay the paragraph just read |
| go back · skip | Previous or next sentence |
| faster · slower | Change speed by 0.2x |
| read this page · read highlighted | Read everything, or only the highlight |
| add last paragraph to memory · add last sentence to memory · add this page to memory · add highlighted to memory | Save to memory |
| clear memory | Empty memory (asks first) |
| scan | Colour your name and word groups, and say how many were found |
| summarize … | Summarize and read the summary aloud |
| connect the dots · list issues | Run that analysis into the panel |
| explain … · research … · look up … | Research the highlight or your question, and read the answer aloud |
| write an email to Mike about … · reply to … | Draft an Outlook email |
| write a document about … | Draft a Word document |
| Teams message about … · Slack message about … | Draft a chat message |
| read it · open in Outlook · open in Word · save it · copy it | Act on the last draft |
| connect my … vault · disconnect the vault | Choose or switch off the Obsidian vault |
| open the manual | Open this manual |
| Claude, … | Ask any question and hear a short spoken answer |

**Speak clearly and say one command at a time.** Questions must start with "Claude", so stray speech near the mic is never sent anywhere. If the app says it heard nothing, check the microphone in **⚙ → Reading & notes → Microphone**.

## Shortcuts and Settings

The shortcuts work in every program while the app is in the tray.

| Keys | Does |
| --- | --- |
| Ctrl+Alt+R | Read the highlighted text |
| Ctrl+Alt+M | Add the highlighted text to memory |
| Ctrl+Alt+O | Read the text in the window in front |
| Ctrl+Alt+V | Push-to-talk for a voice command |
| Ctrl+Alt+Space | Pause or resume |
| Ctrl+Alt+S | Stop |
| Esc | Stop (in the reader) |
| Alt+click a word | Start reading there (in the reader) |

**Change any of them** in **⚙ → Reading & notes → Shortcut keys**: click the box next to an action and press the keys you want (Ctrl or Alt plus a key). The app checks your choice straight away and marks it:

- **✗** when it cannot be used: another action here already has it, another running program has taken it, or it has no Ctrl or Alt.
- **⚠** when Windows or a common program uses it (for example Ctrl+Alt+R types ® in Word). You can still save it; that program just will not get those keys while Read Aloud Pro runs.

Click **Save shortcut keys** and the new keys work at once. **Back to the defaults** restores the original set. Backspace in a box removes that action's key. If a key is taken when the app starts, it tells you which one.

**Settings** (⚙) has three tabs:

| Tab | Setting | What it is for |
| --- | --- | --- |
| Highlighting | Profiles, word groups, terms, colours, your name | What the Find tab looks for |
| Highlighting | Scan every page automatically | Colour every new text as it loads (off by default) |
| Reading & notes | Voice | Natural voices on this PC (recommended) or Windows voices |
| Reading & notes | Microphone | Which mic voice commands listen to, with a 3-second level test |
| Reading & notes | Speaker | Which speaker or headset the natural voice plays on |
| Reading & notes | Reading | Alt+click to start reading; scroll to follow the voice |
| Reading & notes | Shortcut keys | Change the key for each action, with warnings about keys already in use |
| Reading & notes | Updates | Shows your version. Updates install automatically by default: the app downloads a new version in the background and asks before restarting (or installs it the next time you quit). Untick to stop; **Check now** checks on demand |
| Reading & notes | Where saved files go | A folder in Downloads, or any folder such as Google Drive or OneDrive (files saved there upload on their own). **Test save** checks it |
| Claude & library | How to connect Claude | Off, Claude Code on this computer (your plan), or an Anthropic API key (billed per use); model choice; **Test connection** |
| Claude & library | Obsidian vault | Which vault to search, folders to skip, **Test** |
| Claude & library | Reference library | Built-in guides, your standard work and references |

Saved notes, emails and documents go to **Documents\Read Aloud Pro Notes** unless you change it.

## Privacy: what stays on your PC and what goes to Claude

Reading, highlighting, finding, screen reading and voice commands never leave your PC. Text goes to Claude only when you press a Claude button or speak a Claude command.

| Stays on this PC | Sent to Claude when you ask |
| --- | --- |
| Every text you read, and the voice that reads it | The memory items in use (today's, plus any you tick) |
| Your name, word groups and scan results | The text you highlighted for Research |
| Screen captures used by Read screen (deleted right after) | Switched-on reference library documents |
| Your speech for voice commands (recognised on the PC) | The few Obsidian notes that match the request, listed in the answer |
| Memory items, until you use them | Your request text |
| The whole Obsidian vault | For Research only: web searches, which Claude is instructed to keep to general terms, never names or internal numbers |

**Rules the app follows:** it never sends an email, never posts to Teams or Slack, and saves your notes, emails and documents only to the folder you chose. Outlook drafts wait for you to press Send. Your API key, if you use one, is stored only on this PC.

**Your part:** follow your company's policy for work material, only connect a vault meant for the work, and read a draft before you send it.

## Working well: everyday workflows

These are the routines the app was designed around. Each one takes a minute or two.

**1. Triage a long email.**

1. Highlight the email body in Outlook and press **Ctrl+Alt+R**.
2. While it reads, glance at the **Find** tab: your name, safety and controllable failures are counted.
3. Use **‹ ›** to jump to anything coloured, and **▶ read from here** to hear it again.
4. Still unclear? Highlight the phrase and press **Research**.

**2. Get the gist before a meeting.** Load the email or report, then press **Summarize** and **▶ Read aloud**. Listen while you walk or set up. Follow with **List issues** if safety or failures are on the agenda.

**3. Reply to a thread that spans several emails.**

1. For each email, highlight it and press **Ctrl+Alt+M**.
2. In the Claude tab, check the memory items in use; tick older related ones if needed.
3. Type the ask: *"Reply to Dana confirming the briefing is done, list the 3 open questions, short."*
4. Choose **Outlook email**, press **Write**, read it, then **Open in Outlook**. Fix any \[brackets\] and send it yourself.

**4. Spot patterns across a week of reports.** Add each daily report to memory (they are dated). Tick the older ones, then press **Connect the dots**. It points out repeats, contradictions and gaps against your standard work, with quotes so you can check each claim.

**5. Read what cannot be highlighted.** Press **Read screen** and pick the window, for example a scanned PDF or a remote desktop. Check the reader for misread words before you send the text to Claude.

**Tips:**

- Listen at 1.2x to 1.5x for email; slow down for procedures.
- Keep the library to current standard work. An outdated document gives confidently outdated answers.
- Make a profile per job (triage, audit, shift handover) so the colours mean something at a glance.
- Always read a draft before sending. Claude is good, but you own what goes out.

## Troubleshooting and known limits

Most problems come from the wrong window being in front, Claude being off, or the wrong microphone. Check those first.

| Problem | What to do |
| --- | --- |
| "Nothing highlighted came through" | Keep the window with your highlight in front, press Ctrl+Alt+R, and let go of the keys. If the reader itself was in front, the app goes back to the program you used just before |
| A shortcut does nothing | Check the yellow tray icon is there. Shortcuts do not work while the PC is locked or a remote session is disconnected. A startup message names any key another program has taken |
| The first read takes a minute | The voice is downloading or loading. Later reads start in about 1 to 2 seconds |
| Reading stops partway | Press ⏯ or Alt+click the next word to carry on. This was seen once and is being investigated; note what you were reading and report it |
| Read screen gives jumbled words | Pick the single window rather than the whole screen, and make the text larger. Text recognition reads what is shown, so small or stylised fonts misread |
| Voice commands hear nothing | **⚙ → Reading & notes → Microphone**: pick your real mic and run the 3-second test |
| "Claude is off" | Claude tab → **Turn on: use my Claude Code login** |
| "Not signed in, or the login expired" | Open a terminal, type `claude`, then `/login` |
| Open in Outlook opens a file instead of a draft window | The new Outlook cannot be automated. Use classic Outlook, or open the file and send from there |
| Windows warns when installing | The app is not code-signed. Click **More info**, then **Run anyway** |
| An update did not arrive | **⚙ → Reading & notes → Updates → Check now** shows the result. Updates need internet and come from the app's GitHub releases |

**Known limits:**

- The first start needs internet for the voice download (about 330 MB, plus about 150 MB the first time you use voice commands).
- Within a sentence, the natural voice's highlight can be a word ahead or behind; it never drifts across sentences.
- A scanned PDF has no text inside it. Open it and use Read screen, one page at a time.
- Memory items are cut at 200,000 characters each, and the library at 250,000 characters in total. The app says so when it happens.
- Claude answers count against your own Claude plan, or are billed to your API key if you use one.
