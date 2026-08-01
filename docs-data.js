/* ========================================================================
   VERIDIC — Documentation data
   ------------------------------------------------------------------------
   The tool catalogue is data, not markup, so the docs page can search and
   filter across every tool without hand-maintaining ~80 blocks of HTML.

   Each tool: { name, sig, desc, tags[], confirm?, gated?, note? }
     confirm : agent must get explicit user confirmation before running
     gated   : requires a capability token, or is off unless enabled
   ======================================================================== */

window.VERIDIC_TOOLS = [
  {
    id: 'launcher',
    icon: 'fa-rocket',
    title: 'App Launcher',
    blurb:
      'One fuzzy-matched entry point for every executable on the machine. At first use VERIDIC builds ' +
      'an application index by scanning the Start Menu, Program Files, everything on PATH, registry ' +
      'uninstall entries and Windows system apps, then caches it to <code>app_index_cache.json</code>. ' +
      'The index is built lazily — startup never blocks on the ~10s scan.',
    tools: [
      {
        name: 'launch_app',
        sig: 'launch_app(app_name: str)',
        desc:
          'Launch any Windows application by name. The name is fuzzy-matched (0.6 similarity floor) ' +
          'against the app index, so "photoshop", "ps" and "adobe photoshop" all resolve. After spawning, ' +
          'VERIDIC waits a short verify window (default 50ms, tunable via performance.launch_verify_ms) ' +
          'to catch an immediate crash and report failure honestly instead of claiming success.',
        tags: ['apps', 'voice'],
      },
      {
        name: 'launch_system_app',
        sig: 'launch_system_app(app_name: str)',
        desc: 'Backwards-compatible alias bound to the same function as launch_app. Kept so older workflows and plugins keep working.',
        tags: ['apps', 'alias'],
      },
      {
        name: 'Play_file',
        sig: 'Play_file(name: str)',
        desc:
          'Search the user\'s folders for a file or app by name and open it with the system default handler. ' +
          'This is the "just open the thing" tool — use it when the user says open, play or launch and it is ' +
          'unclear whether the target is a document, a media file or a program.',
        tags: ['files', 'apps'],
      },
      {
        name: 'search_files',
        sig: 'search_files(query: str, max_results: int)',
        desc:
          'Search the user\'s folders and return a ranked list of matches with full paths — without opening ' +
          'anything. The read-only counterpart to Play_file, for when the user asks where something is.',
        tags: ['files', 'search'],
      },
    ],
  },

  {
    id: 'files',
    icon: 'fa-folder-open',
    title: 'Files & Documents',
    blurb:
      'Every write goes through path validation before it touches disk: the target is resolved, checked ' +
      'against the allowed roots, and given the right extension for its format. Overwrites and folder ' +
      'deletions are gated behind explicit confirmation rather than being inferred from phrasing.',
    tools: [
      { name: 'open_folder', sig: 'open_folder(path: str)', desc: 'Open a folder in Explorer by absolute or relative path, after validating that the path resolves inside an allowed root.', tags: ['files'] },
      { name: 'open_folder_by_name', sig: 'open_folder_by_name(name: str)', desc: 'Open a folder by friendly name — "desktop", "downloads", "documents", "projects" and similar aliases resolve to the real user directory without the LLM having to guess a path.', tags: ['files', 'voice'] },
      { name: 'create_text_file', sig: 'create_text_file(filename, content, path=None)', desc: 'Write a plain-text file. Missing extensions are filled in automatically; the default destination is the managed projects folder when no path is given.', tags: ['files', 'write'] },
      { name: 'create_docx_file', sig: 'create_docx_file(filename, content, path=None, overwrite=False)', desc: 'Generate a Microsoft Word .docx. Inline markdown-style emphasis in the content is converted into real formatted runs, so headings and bold text survive into the document rather than arriving as literal asterisks.', tags: ['files', 'documents', 'write'] },
      { name: 'create_pptx_presentation', sig: 'create_pptx_presentation(...)', desc: 'Build a PowerPoint deck from structured slide input — titles, bullet lists and per-slide layout. Use when the caller already knows the slide breakdown.', tags: ['files', 'documents', 'write'] },
      { name: 'create_pptx_from_text', sig: 'create_pptx_from_text(filename, content, path=None, overwrite=False, theme_name=None)', desc: 'Turn prose into a themed slide deck: the text is segmented into slides automatically and rendered with the chosen theme. The conversational path — "make me a deck about X".', tags: ['files', 'documents', 'write'] },
      { name: 'create_document', sig: 'create_document(filename, content, path=None, overwrite=False)', desc: 'Format-dispatching wrapper — inspects the requested extension and routes to the text, Word or PowerPoint writer so the caller does not have to pick.', tags: ['files', 'documents', 'write'] },
      { name: 'read_file', sig: 'read_file(path: str)', desc: 'Read a file\'s contents back into the conversation, subject to path validation and size limits.', tags: ['files', 'read'] },
      { name: 'append_to_file', sig: 'append_to_file(path: str, content: str)', desc: 'Append to an existing file without rewriting it — the safe way to add to a running log or notes file.', tags: ['files', 'write'] },
      { name: 'overwrite_file', sig: 'overwrite_file(path: str, content: str, confirm=False)', desc: 'Replace a file\'s entire contents. Refuses to run until confirm is explicitly true, so a misheard instruction cannot silently destroy a file.', tags: ['files', 'write'], confirm: true },
      { name: 'save_content', sig: 'save_content(content: str, filename: str)', desc: 'Quick-save arbitrary content to the managed workspace under a chosen name — the "just write this down" shortcut.', tags: ['files', 'write'] },
      { name: 'list_files', sig: 'list_files(path=None, pattern="*")', desc: 'List directory contents with optional glob filtering. Defaults to the managed workspace when no path is supplied.', tags: ['files', 'read'] },
      { name: 'create_folder', sig: 'create_folder(path: str)', desc: 'Create a directory, validating the parent exists and the location is permitted.', tags: ['files', 'write'] },
      { name: 'delete_folder', sig: 'delete_folder(path: str, recursive=False)', desc: 'Delete a directory. Non-recursive by default, and confirmation-gated in the registry — recursive deletion always requires an explicit user yes.', tags: ['files', 'destructive'], confirm: true },
    ],
  },

  {
    id: 'vision',
    icon: 'fa-eye',
    title: 'Vision & Camera',
    blurb:
      'Both the screen and the webcam are treated as privacy surfaces. The camera is <strong>off by ' +
      'default</strong> and stays off until explicitly enabled; screen analysis is confirmation-gated ' +
      'because a screenshot can contain anything currently on the display.',
    tools: [
      { name: 'analyze_screen', sig: 'analyze_screen(prompt: str, region="top,left,width,height")', desc: 'Capture the screen (or a specific rectangle of it) and answer a question about what is visible using AI vision. Confirmation-gated — VERIDIC asks before it looks at your display.', tags: ['vision', 'privacy'], confirm: true },
      { name: 'see_camera', sig: 'see_camera(prompt: str)', desc: 'Take a frame from the webcam and describe what is in front of it. Returns an error rather than a guess if the camera has not been enabled.', tags: ['vision', 'privacy'] },
      { name: 'enable_camera', sig: 'enable_camera()', desc: 'Explicitly turn the camera on for vision tools. Confirmation-gated. Nothing in the system enables the camera implicitly — this call is the only route.', tags: ['vision', 'privacy'], confirm: true },
      { name: 'disable_camera', sig: 'disable_camera()', desc: 'Turn the camera back off. Never gated — reducing access is always allowed to proceed immediately.', tags: ['vision', 'privacy'] },
      { name: 'register_user_face', sig: 'register_user_face(name: str)', desc: 'Enrol a new face for the Face ID login gate, capturing a sample set and storing the resulting centroid. Confirmation-gated, since it changes who can unlock the assistant.', tags: ['vision', 'security'], confirm: true },
    ],
  },

  {
    id: 'memory',
    icon: 'fa-brain',
    title: 'Memory & Knowledge',
    blurb:
      'A two-tier memory: a local SQLite store for offline-capable recall, plus optional Mem0 cloud memory ' +
      'fetched at session start under a hard timeout (0.5s by default) so a slow network can never stall ' +
      'the voice loop. Forgetting is a first-class operation, not an afterthought.',
    tools: [
      { name: 'remember_fact', sig: 'remember_fact(entity: str, attribute: str, value: str)', desc: 'Store a long-term fact as an entity–attribute–value triple, e.g. ("my laptop", "gpu", "RTX 4060"). Structured storage means later recall is a lookup rather than a similarity guess.', tags: ['memory', 'write'] },
      { name: 'query_knowledge', sig: 'query_knowledge(query: str)', desc: 'Search long-term memory and return matching facts. This is what lets VERIDIC answer "what did I tell you about the server?" across sessions.', tags: ['memory', 'read'] },
      { name: 'link_entities', sig: 'link_entities(source: str, target: str, relation: str)', desc: 'Record a typed relationship between two entities, turning the flat fact store into a small knowledge graph that supports multi-hop recall.', tags: ['memory', 'write'] },
      { name: 'forget_fact', sig: 'forget_fact(entity: str, attribute: str)', desc: 'Remove one specific attribute from memory, leaving the rest of the entity intact.', tags: ['memory', 'privacy'] },
      { name: 'forget_entity', sig: 'forget_entity(entity: str)', desc: 'Remove an entity and all of its recorded attributes and relationships.', tags: ['memory', 'privacy'] },
      { name: 'delete_conversation_history', sig: 'delete_conversation_history()', desc: 'Irreversibly delete all stored conversation history for the current user. Confirmation-gated, and genuinely irreversible — there is no server-side copy.', tags: ['memory', 'privacy', 'destructive'], confirm: true },
    ],
  },

  {
    id: 'health',
    icon: 'fa-heart-pulse',
    title: 'System Health & Processes',
    blurb:
      'Live introspection of the host: what is running, what is consuming it, and what to do about it. ' +
      'Read operations are unrestricted; anything that terminates a process requires confirmation.',
    tools: [
      { name: 'check_system_health', sig: 'check_system_health()', desc: 'Snapshot of CPU, RAM and disk utilisation with a plain-language summary — the first call when the user says "why is my PC slow?"', tags: ['system', 'read'] },
      { name: 'find_resource_hogs', sig: 'find_resource_hogs(resource="cpu", top_n=5)', desc: 'Rank running processes by CPU or memory consumption and return the top offenders with their PIDs, ready to hand to kill_process.', tags: ['system', 'read'] },
      { name: 'kill_process', sig: 'kill_process(pid: int)', desc: 'Terminate a process by PID. Confirmation-gated — VERIDIC names the process and waits for a yes before killing anything.', tags: ['system', 'destructive'], confirm: true },
      { name: 'optimize_system_resources', sig: 'optimize_system_resources()', desc: 'Reclaim resources by running memory garbage collection and clearing temp folders. Conservative by design: it does not touch user data or installed software.', tags: ['system', 'maintenance'] },
      { name: 'get_process_cpu_history', sig: 'get_process_cpu_history(duration_seconds=1.0, top_n=5)', desc: 'Sample CPU usage per process across a time window instead of a single instant — catches bursty processes that a one-shot snapshot misses.', tags: ['system', 'read'] },
    ],
  },

  {
    id: 'security-tools',
    icon: 'fa-shield-virus',
    title: 'Security & Antivirus',
    blurb:
      'Wraps Windows Defender rather than shipping a competing scanner, so results match what the OS ' +
      'already believes about the machine.',
    tools: [
      { name: 'scan_system_virus', sig: 'scan_system_virus()', desc: 'Run a Windows Defender quick scan and report the outcome. Confirmation-gated because a scan is CPU-heavy and long-running.', tags: ['security'], confirm: true },
      { name: 'check_virus_threats', sig: 'check_virus_threats()', desc: 'Read back active threats and quarantined items from Defender — a cheap status check that does not start a scan.', tags: ['security', 'read'] },
    ],
  },

  {
    id: 'observability',
    icon: 'fa-chart-line',
    title: 'Observability',
    blurb:
      'Metrics, audit trails and service control. Read paths are open; anything that mutates service state ' +
      'requires a capability token, so the LLM cannot stop a service on its own initiative.',
    tools: [
      { name: 'access_system_metrics', sig: 'access_system_metrics(category="all")', desc: 'Structured metrics across CPU, RAM, disk and network. Filter by category to keep the response small when only one dimension matters.', tags: ['observability', 'read'] },
      { name: 'security_audit', sig: 'security_audit(lookback_hours=24)', desc: 'Analyse the security log for the given window: which actions were blocked, which tools were denied, and what triggered them. This is how the permission layer stays auditable.', tags: ['observability', 'security', 'read'] },
      { name: 'predictive_analysis', sig: 'predictive_analysis()', desc: 'Advisory scan of current system state for conditions that tend to precede failure — disk pressure, thermal trends, memory growth. Reports risk; it never acts on its own.', tags: ['observability', 'read'] },
      { name: 'manage_services', sig: 'manage_services(service_name, action="status", token=None)', desc: 'Query or control Windows services. status is free; start, stop and restart are mutations and require a valid capability token.', tags: ['observability', 'system'], gated: 'Token required for start / stop / restart' },
    ],
  },

  {
    id: 'sentinel',
    icon: 'fa-tower-observation',
    title: 'Sentinel — Predictive Monitoring',
    blurb:
      'A background monitoring engine that keeps rolling metric history and projects it forward, so VERIDIC ' +
      'can raise a problem before it becomes an outage rather than describing one after the fact.',
    tools: [
      { name: 'get_system_predictions', sig: 'get_system_predictions()', desc: 'Current failure predictions from the Sentinel engine — what it thinks is trending toward trouble, and how soon.', tags: ['sentinel', 'read'] },
      { name: 'get_trend_report', sig: 'get_trend_report(metric="all")', desc: 'Trend analysis over the monitoring window for one metric or all of them: direction, rate of change, and whether it is accelerating.', tags: ['sentinel', 'read'] },
      { name: 'configure_sentinel', sig: 'configure_sentinel(action="status", metric=None, threshold=None)', desc: 'Inspect or reconfigure the monitor — enable and disable metrics, adjust alert thresholds, or read back the current configuration.', tags: ['sentinel', 'config'] },
      { name: 'get_proactive_suggestions', sig: 'get_proactive_suggestions()', desc: 'Workflow and optimisation suggestions derived from observed usage patterns — recurring manual sequences that are candidates for automation.', tags: ['sentinel', 'read'] },
    ],
  },

  {
    id: 'synthesizer',
    icon: 'fa-diagram-project',
    title: 'Synthesizer — System Context',
    blurb:
      'Where Sentinel watches individual metrics, the Synthesizer folds them into a single picture: one ' +
      'health score, one security posture, one answer to "what is this person actually doing right now".',
    tools: [
      { name: 'get_system_health_score', sig: 'get_system_health_score()', desc: 'A holistic 0–100 health score with the per-factor breakdown that produced it, so the number is explainable rather than opaque.', tags: ['synthesizer', 'read'] },
      { name: 'get_system_context', sig: 'get_system_context()', desc: 'Infer what the user is currently doing from which applications are running and focused — gaming, coding, in a meeting — so responses can adapt to the situation.', tags: ['synthesizer', 'read'] },
      { name: 'get_security_status', sig: 'get_security_status()', desc: 'Consolidated security posture: firewall, Defender, pending updates and recent blocked actions in one summary.', tags: ['synthesizer', 'security', 'read'] },
      { name: 'set_system_profile', sig: 'set_system_profile(profile="balanced")', desc: 'Switch the machine\'s performance profile — power saver, balanced or performance — in one call instead of walking Windows settings.', tags: ['synthesizer', 'system'] },
      { name: 'get_service_health', sig: 'get_service_health()', desc: 'Health of the critical services VERIDIC depends on, so a degraded subsystem surfaces as a clear status rather than a mysterious failure downstream.', tags: ['synthesizer', 'read'] },
    ],
  },

  {
    id: 'skills',
    icon: 'fa-puzzle-piece',
    title: 'Capability Acquisition',
    blurb:
      'When VERIDIC lacks a capability, it can go and get one: search PyPI for a package that provides it, ' +
      'install it under the standard confirmation gate, and register the resulting tools. Acquired skills ' +
      'are tracked with usage statistics and can be removed again.',
    tools: [
      { name: 'acquire_skill', sig: 'acquire_skill(description: str)', desc: 'Describe a needed capability in plain language and let VERIDIC find, vet and install something that provides it. The install itself still passes through the confirmation gate — acquisition is proposed, never silent.', tags: ['skills'], confirm: true },
      { name: 'list_acquired_skills', sig: 'list_acquired_skills()', desc: 'List every dynamically acquired capability along with how often each has been used — the audit trail for what the assistant has taught itself.', tags: ['skills', 'read'] },
      { name: 'search_available_skills', sig: 'search_available_skills(query: str)', desc: 'Search PyPI for packages matching a capability need without installing anything. The reconnaissance step before acquire_skill.', tags: ['skills', 'read'] },
      { name: 'remove_skill', sig: 'remove_skill(skill_name: str)', desc: 'Unregister a previously acquired skill and remove its tools from the registry.', tags: ['skills'] },
    ],
  },

  {
    id: 'installer',
    icon: 'fa-box-open',
    title: 'Software Installation',
    blurb:
      'All installers honour a <code>dry_run</code> parameter that defaults to <strong>true</strong> — the ' +
      'default behaviour is to report what would happen. Every one is confirmation-gated with a 5-minute ' +
      'timeout, because package installs are slow and irreversible in ways a voice command should not be.',
    tools: [
      { name: 'install_app', sig: 'install_app(package_id: str, dry_run=True)', desc: 'Install a Windows application through winget by package id. Dry run by default; the real install requires both dry_run=False and user confirmation.', tags: ['installer', 'system'], confirm: true },
      { name: 'install_python_package', sig: 'install_python_package(package_name: str, dry_run=True)', desc: 'Install a Python package with pip into the managed virtual environment — never the system interpreter.', tags: ['installer'], confirm: true },
      { name: 'install_package_chain', sig: 'install_package_chain(manifest: dict, dry_run=True)', desc: 'Install a set of packages with dependency resolution, so a multi-package setup is ordered correctly instead of failing halfway.', tags: ['installer'], confirm: true },
      { name: 'install_package_verified', sig: 'install_package_verified(package_name: str)', desc: 'Install a PyPI package with an additional verification pass before it is accepted — the hardened path used by capability acquisition.', tags: ['installer'], confirm: true },
      { name: 'update_system', sig: 'update_system(dry_run=True)', desc: 'Run system-wide package updates. Dry run by default so the user sees the change list before anything is applied.', tags: ['installer', 'system'], confirm: true },
      { name: 'edit_registry', sig: 'edit_registry(path, key, value, operation="add", dry_run=True)', desc: 'Read, add or remove a Windows registry value. Paths are parsed and validated against the known hives before any write.', tags: ['installer', 'system', 'destructive'], confirm: true },
      { name: 'install_driver', sig: 'install_driver(path: str, dry_run=True)', desc: 'Install a driver from a local .inf file. The highest-privilege operation in the toolset and gated accordingly.', tags: ['installer', 'system', 'destructive'], confirm: true },
    ],
  },

  {
    id: 'web',
    icon: 'fa-globe',
    title: 'Web & Search',
    blurb:
      'Lightweight web access for research and quick navigation. Scraping runs through a data-governance ' +
      'check rather than fetching whatever URL it is handed.',
    tools: [
      { name: 'open_browser', sig: 'open_browser(url: str)', desc: 'Open a specific URL in the default browser. Intended for when the user supplies a full URL — vaguer requests go to browse_to.', tags: ['web'] },
      { name: 'search_youtube', sig: 'search_youtube(query: str)', desc: 'Search YouTube and open the results — the path for tutorials, lectures and music requests.', tags: ['web'] },
      { name: 'web_scrape', sig: 'web_scrape(url: str, token=None)', desc: 'Fetch and extract the readable content of a page, subject to data-governance rules on what may be retrieved and retained.', tags: ['web', 'read'] },
      {
        name: 'google_search',
        sig: 'google_search(query: str)',
        desc: 'Search Google via the Custom Search JSON API and return the top results as text.',
        tags: ['web', 'read'],
        gated: 'Disabled by default',
        note:
          'Not registered unless <code>VERIDIC_WEB_SEARCH_ENABLED=true</code> is set. The Custom Search API ' +
          'requires a billing-linked Google Cloud project; without one every call returns 403, so the tool ' +
          'is left unregistered rather than failing at runtime.',
      },
    ],
  },

  {
    id: 'browser',
    icon: 'fa-window-restore',
    title: 'Browser Automation (Playwright)',
    blurb:
      'A full driven browser, not just a URL opener. VERIDIC can navigate, read the page, click by visible ' +
      'text, fill forms and manage tabs — which is what makes "log into the portal and download this ' +
      'month\'s invoice" a single spoken instruction. Requires Playwright; the tools are skipped cleanly ' +
      'if it is not installed.',
    tools: [
      { name: 'browse_to', sig: 'browse_to(query: str)', desc: 'Open any site by name or search query — resolves the destination automatically rather than requiring an exact URL. Handles "open YouTube", "go to Amazon", "find Python tutorials".', tags: ['browser'] },
      { name: 'browser_click', sig: 'browser_click(text: str)', desc: 'Click an element by its visible text. Matching on what a human can see keeps commands like "click Sign In" robust against markup changes.', tags: ['browser'] },
      { name: 'browser_type', sig: 'browser_type(text: str, field=None)', desc: 'Type into a field, optionally targeted by label. Used for forms, search bars and login fields.', tags: ['browser'] },
      { name: 'browser_search', sig: 'browser_search(query: str, field="Search")', desc: 'Type into a search box on the current page and submit — the common type-then-Enter pair in one call.', tags: ['browser'] },
      { name: 'browser_press_key', sig: 'browser_press_key(key: str)', desc: 'Send a keyboard key: Enter, Tab, Escape, Backspace, Space or an arrow key.', tags: ['browser'] },
      { name: 'browser_scroll', sig: 'browser_scroll(direction: str)', desc: 'Scroll the page up or down to bring off-screen content into view before reading or clicking it.', tags: ['browser'] },
      { name: 'browser_go_back', sig: 'browser_go_back()', desc: 'Navigate back one entry in history.', tags: ['browser'] },
      { name: 'browser_new_tab', sig: 'browser_new_tab(url=None)', desc: 'Open a new tab, optionally navigating straight to a URL.', tags: ['browser'] },
      { name: 'browser_close_tab', sig: 'browser_close_tab()', desc: 'Close the current tab, leaving the browser session running.', tags: ['browser'] },
      { name: 'browser_page_info', sig: 'browser_page_info()', desc: 'Return the current page title and URL — how the agent confirms where it actually ended up before acting.', tags: ['browser', 'read'] },
      { name: 'browser_close', sig: 'browser_close()', desc: 'Shut the browser down entirely and release the Playwright session.', tags: ['browser'] },
    ],
  },

  {
    id: 'execution',
    icon: 'fa-terminal',
    title: 'Data & Code Execution',
    blurb:
      'The sharpest tools in the box, and the most tightly held. Arbitrary code execution and system ' +
      'configuration changes both require a capability token — the model cannot reach them by reasoning ' +
      'its way there.',
    tools: [
      { name: 'query_database', sig: 'query_database(db_path: str, query: str, params=None)', desc: 'Run a parameterised query against a SQLite database, with read and write paths separated so a SELECT and an UPDATE are not treated as equivalent risk.', tags: ['data'] },
      { name: 'execute_script', sig: 'execute_script(code: str, language="python", token=None)', desc: 'Execute code in a guarded subprocess with timeout and output capture. Token-gated: without a valid capability token the call is refused.', tags: ['execution', 'destructive'], gated: 'Capability token required' },
      { name: 'configure_system_settings', sig: 'configure_system_settings(action, key, value, token=None)', desc: 'Read or modify system settings, including registry-backed configuration. Token-gated for the same reason as execute_script.', tags: ['system', 'destructive'], gated: 'Capability token required' },
    ],
  },

  {
    id: 'automation-tools',
    icon: 'fa-bolt',
    title: 'Automation',
    blurb:
      'Multi-step routines defined in <code>user_workflows.json</code>, runnable by id or by their trigger ' +
      'phrase. Because a routine is data rather than a prompt, it runs the same way every time.',
    tools: [
      { name: 'run_automation', sig: 'run_automation(workflow_id: str)', desc: 'Execute a saved automation routine by id, running its steps in order and reporting each result.', tags: ['automation'] },
      { name: 'list_automations', sig: 'list_automations()', desc: 'List saved routines with their trigger phrases — how VERIDIC answers "what can you do automatically?" from real configuration rather than invention.', tags: ['automation', 'read'] },
    ],
  },

  {
    id: 'info',
    icon: 'fa-cloud-sun',
    title: 'Information',
    blurb: 'External data lookups that need a real source rather than a plausible-sounding answer.',
    tools: [
      { name: 'get_weather', sig: 'get_weather(city: str)', desc: 'Current conditions and forecast for a city via OpenWeather. Requires an OpenWeather API key in .env; returns an explicit error rather than a guess when the key is missing.', tags: ['info', 'read'] },
    ],
  },

  {
    id: 'minecraft',
    icon: 'fa-cubes',
    title: 'Minecraft Bridge',
    blurb:
      'Shipped through the <code>minecraft_link</code> plugin rather than the core registry, so it loads ' +
      'only when the plugin is enabled and a bot bridge is reachable. Gives the agent a real presence in ' +
      'the world — movement, mining, inventory, combat — driven by the same tool-calling loop as everything else.',
    tools: [
      { name: 'mc_ping', sig: 'mc_ping()', desc: 'Check that the bot bridge is alive and responding before issuing any other Minecraft call.', tags: ['minecraft', 'read'] },
      { name: 'mc_get_player_state', sig: 'mc_get_player_state()', desc: 'Read position, health, hunger and orientation for the controlled bot.', tags: ['minecraft', 'read'] },
      { name: 'mc_get_inventory', sig: 'mc_get_inventory()', desc: 'List the bot\'s current inventory contents and slot assignments.', tags: ['minecraft', 'read'] },
      { name: 'mc_get_nearby_entities', sig: 'mc_get_nearby_entities(radius=32)', desc: 'Enumerate entities within a radius — mobs, players and items — with their types and positions.', tags: ['minecraft', 'read'] },
      { name: 'mc_move_to', sig: 'mc_move_to(x: float, y: float, z: float)', desc: 'Pathfind and walk to a set of world coordinates.', tags: ['minecraft'] },
      { name: 'mc_look_at', sig: 'mc_look_at(x: float, y: float, z: float)', desc: 'Aim the bot\'s view at a point — the prerequisite for accurate mining and attacks.', tags: ['minecraft'] },
      { name: 'mc_jump', sig: 'mc_jump()', desc: 'Jump, for clearing a block-height obstacle or escaping a hole.', tags: ['minecraft'] },
      { name: 'mc_mine_block', sig: 'mc_mine_block(x: float, y: float, z: float)', desc: 'Break the block at the given coordinates, selecting an appropriate tool where possible.', tags: ['minecraft'] },
      { name: 'mc_attack_entity', sig: 'mc_attack_entity(entity_id: str)', desc: 'Attack a specific entity by id, as returned by mc_get_nearby_entities.', tags: ['minecraft'] },
      { name: 'mc_chat', sig: 'mc_chat(message: str)', desc: 'Send a message to server chat as the bot.', tags: ['minecraft'] },
      { name: 'mc_get_time', sig: 'mc_get_time()', desc: 'Read the in-world time — the check before deciding whether it is safe to be above ground.', tags: ['minecraft', 'read'] },
      { name: 'mc_auto_engage', sig: 'mc_auto_engage(target_type="hostile", duration_seconds=30)', desc: 'Autonomously select and fight targets of a given type for a bounded duration. The time limit is deliberate — no open-ended combat loop.', tags: ['minecraft', 'combat'] },
      { name: 'mc_defensive_retreat', sig: 'mc_defensive_retreat(distance=None)', desc: 'Disengage and withdraw from current threats to a safer distance.', tags: ['minecraft', 'combat'] },
      { name: 'mc_engage_pvp', sig: 'mc_engage_pvp(...)', desc: 'Player-versus-player combat routine with target tracking, strafing and health-aware disengagement.', tags: ['minecraft', 'combat'] },
    ],
  },
];

/* ---------------------------------------------------------- app surfaces */

window.VERIDIC_SCREENS = [
  { group: 'Assistant', icon: 'fa-table-cells-large', name: 'Dashboard', desc: 'Landing view for the desktop shell — session state, backend connectivity and quick entry into any other surface.' },
  { group: 'Assistant', icon: 'fa-comment-dots', name: 'Chat', desc: 'Text conversation with the same agent and the same tools as voice. The microphone stays closed here unless you explicitly open it.' },
  { group: 'Assistant', icon: 'fa-microphone', name: 'Voice', desc: 'The live voice session: WebRTC transport, real-time transcript, and a visual indicator for every tool call as it executes.' },
  { group: 'Assistant', icon: 'fa-brain', name: 'Memory', desc: 'Browse, search and delete what VERIDIC remembers about you. Every stored fact is visible and individually removable.' },
  { group: 'Assistant', icon: 'fa-list-check', name: 'Tasks', desc: 'Queued and running work, with per-task status and results.' },
  { group: 'Assistant', icon: 'fa-clock-rotate-left', name: 'History', desc: 'Past conversations, resumable. Resuming restores the agent\'s memory of the session, not just the visible transcript.' },
  { group: 'Labs', icon: 'fa-bolt', name: 'Automation', desc: 'Create and manage the multi-step routines in user_workflows.json — trigger phrases, ordered steps, and manual run.' },
  { group: 'Labs', icon: 'fa-robot', name: 'Agents', desc: 'Configure specialised agent profiles with their own instructions and tool subsets.' },
  { group: 'Labs', icon: 'fa-puzzle-piece', name: 'Extensions', desc: 'Discovered plugins and extension modules with their manifests, declared permissions and enable state.' },
  { group: 'Labs', icon: 'fa-folder-tree', name: 'Files', desc: 'The managed workspace — everything VERIDIC has created or been given, browsable in place.' },
  { group: 'System', icon: 'fa-gear', name: 'Settings', desc: 'Voice mode, LLM routing, API key presence, feature flags and performance tuning. Keys show as present or missing; raw values are never rendered.' },
  { group: 'System', icon: 'fa-id-card', name: 'License', desc: 'Hardware ID, activation state and license management.' },
  { group: 'System', icon: 'fa-download', name: 'Updates', desc: 'Version check against the release channel, with changelog.' },
  { group: 'System', icon: 'fa-file-lines', name: 'Logs', desc: 'Rotating operational logs from %APPDATA%\\Veridic\\logs, filterable by level.' },
  { group: 'System', icon: 'fa-microchip', name: 'Developer', desc: 'Registry inspection, tool invocation and diagnostics for people extending VERIDIC.' },
];

/* -------------------------------------------------------------- plugins */

window.VERIDIC_PLUGINS = [
  { name: 'example_plugin', desc: 'The reference implementation — the smallest complete plugin, kept working as a template to copy.' },
  { name: 'home_assistant', desc: 'Bridges Home Assistant so lights, switches and scenes become voice-callable tools.' },
  { name: 'minecraft_link', desc: 'Connects the Minecraft bot bridge and registers the full mc_* toolset.' },
  { name: 'obs_controller', desc: 'Drives OBS Studio — scene switching, recording and streaming control for creators.' },
  { name: 'spotify_media', desc: 'Spotify playback control: play, pause, skip and playlist selection by voice.' },
];

/* ------------------------------------------------------------ REST API */

window.VERIDIC_API = [
  { method: 'GET', path: '/api/health', desc: 'Liveness probe for the local API.' },
  { method: 'GET', path: '/api/config', desc: 'Configuration and key <em>presence booleans</em> — never raw key values.', secure: true },
  { method: 'POST', path: '/api/config', desc: 'Update configuration.', secure: true },
  { method: 'DELETE', path: '/api/config', desc: 'Reset configuration values.', secure: true },
  { method: 'GET', path: '/api/status', desc: 'Runtime status of the agent and its subsystems.' },
  { method: 'GET/POST', path: '/api/terms', desc: 'Read and record terms acceptance.' },
  { method: 'POST', path: '/api/test-connection', desc: 'Validate configured credentials against their services.', secure: true },
  { method: 'POST', path: '/api/connection-details', desc: 'Mint a LiveKit participant token and return the server URL.', secure: true },
  { method: 'GET/POST', path: '/api/license', desc: 'Read license state and submit an activation key.' },
  { method: 'GET', path: '/api/updates', desc: 'Check for a newer release.' },
  { method: 'GET', path: '/api/logs', desc: 'Tail the rotating operational log.' },
  { method: 'GET', path: '/api/memory', desc: 'Read stored memory entries.' },
  { method: 'GET/POST', path: '/api/history', desc: 'List past conversations and resume one.' },
  { method: 'GET', path: '/api/tasks', desc: 'Current task queue and per-task state.' },
  { method: 'GET/POST', path: '/api/automations', desc: 'List and manage saved automation routines.' },
  { method: 'GET/POST', path: '/api/agents', desc: 'List and manage configured agent profiles.' },
  { method: 'GET', path: '/api/extensions', desc: 'Discovered plugins and extension modules with manifests.' },
  { method: 'GET/POST', path: '/api/files', desc: 'Browse and manage the managed workspace.' },
];
