window.HARNESS_DATA = {
  models: ['DeepSeek-V4-Pro', 'DeepSeek-R1 0528', 'Claude 3.5 Sonnet'],
  sessions: [
    { id: 'arch42', code: 'ARCH-42', title: 'Refactoring Zahlungsdienst', ago: 'Vor 2 Min. aktualisiert', goal: 'Authentifizierungsdienst mit RBAC implementieren', branch: 'feature/payment-refactor' },
    { id: 'bug187', code: 'BUG-187', title: 'Ablauf von Auth-Tokens', ago: 'Vor 12 Min.', goal: 'Access-Tokens beim Abmelden ablaufen lassen und Refresh-Tokens rotieren', branch: 'fix/token-expiry' },
    { id: 'feat93', code: 'FEAT-93', title: 'Rechnungserstellung', ago: 'Vor 1 Std.', goal: 'Rechnungen mit idempotenten Zahlungsreferenzen erstellen', branch: 'feat/invoices' },
    { id: 'ref66', code: 'REFACTOR-66', title: 'API-Client-Schicht', ago: 'Vor 3 Std.', goal: 'API-Client in Retry, Auth und Transport aufteilen', branch: 'refactor/api-client' },
    { id: 'docs21', code: 'DOCS-21', title: 'Architektur-Entscheidungsprotokoll', ago: 'Vor 5 Std.', goal: 'Entscheidungen zu Auth und Zahlungs-Resilienz festhalten', branch: 'docs/adr' }
  ],
  plugins: [
    { id: 'analyzer', name: 'Code Analyzer', version: 'v1.2.3', on: true, icon: 'scan', color: '#5b9dff' },
    { id: 'tests', name: 'Test Runner', version: 'v2.4.1', on: true, icon: 'beaker', color: '#3ee0a0' },
    { id: 'security', name: 'Security Scanner', version: 'v1.1.0', on: true, icon: 'shield', color: '#f5b942' },
    { id: 'diagram', name: 'Diagram Generator', version: 'v1.0.2', on: true, icon: 'nodes', color: '#a78bfa' },
    { id: 'git', name: 'Git Integration', version: 'v2.0.1', on: true, icon: 'git', color: '#fb7185' },
    { id: 'markdown', name: 'Markdown Exporter', version: 'v1.3.4', on: true, icon: 'doc', color: '#2ee6f0' },
    { id: 'mock', name: 'API Mocking', version: 'v1.0.5', on: true, icon: 'music', color: '#34d399' }
  ],
  catalog: [
    { id: 'shell', name: 'Shell Executor', cat: 'Tools', blurb: 'Shell-Befehle sicher ausführen, mit Unterstützung für mehrere Shells und Umgebungen.', stars: '1.2k', installed: false, verified: true, icon: 'terminal', color: '#2ee6f0' },
    { id: 'copilot', name: 'GitHub Copilot', cat: 'Tools', blurb: 'Binde GitHub-Copilot-Vorschläge und Code-Vervollständigungen in deine Agent-Sitzungen ein.', stars: '2.4k', installed: true, verified: true, icon: 'cube', color: '#8b7cff' },
    { id: 'web', name: 'Web Search', cat: 'Tools', blurb: 'Lass deinen Agent das Web durchsuchen und zusammengefasste, aktuelle Ergebnisse zurückbringen.', stars: '987', installed: false, verified: true, icon: 'chat', color: '#5b9dff' },
    { id: 'snapshot', name: 'UI Snapshot', cat: 'UI', blurb: 'Erfasse, kommentiere und analysiere UI-Screenshots für visuell gesteuerte Workflows.', stars: '642', installed: false, verified: true, icon: 'image', color: '#94a3b8' },
    { id: 'vector', name: 'Vector Memory', cat: 'Memory', blurb: 'Langzeitgedächtnis mit Vektorsuche für besseren Kontext und bessere Erinnerung über Sitzungen hinweg.', stars: '1.1k', installed: true, verified: true, icon: 'brain', color: '#3ee0a0' },
    { id: 'planner', name: 'Task Planner', cat: 'Workflow', blurb: 'Zerlege komplexe Aufgaben, plane Schritte und führe Multi-Step-Workflows zuverlässig aus.', stars: '1.6k', installed: false, verified: true, icon: 'flow', color: '#2ee6f0' },
    { id: 'otel', name: 'OpenTelemetry Exporter', cat: 'Tools', blurb: 'Exportiert Traces und Metriken an OTLP-Endpunkte.', stars: '804', installed: false, verified: true, icon: 'pulse', color: '#5b9dff' },
    { id: 'prompt', name: 'Prompt Optimizer', cat: 'Skills', blurb: 'Optimiert Prompts für Kosten und Leistung.', stars: '1.3k', installed: false, verified: false, icon: 'spark', color: '#f5b942' },
    { id: 'review', name: 'Code Review', cat: 'Skills', blurb: 'Prüft Diffs auf Regressionen, Sicherheit und fehlende Tests vor der Übergabe.', stars: '2.1k', installed: true, verified: true, icon: 'check', color: '#3ee0a0' },
    { id: 'langchain', name: 'LangChain Connector', cat: 'Workflow', blurb: 'Verbindet sich mit LangChain-Runnables und -Agenten.', stars: '756', installed: false, verified: true, icon: 'link', color: '#a78bfa' }
  ],
  layers: [
    { id: 'orch', name: 'Orchestrationsebene', sub: 'Rollenvergabe & Koordination', icon: 'users', nodes: [
      { id: 'po', title: 'Product Owner', sub: 'Anforderungen & Vision', status: 'done' },
      { id: 'architect', title: 'Senior Code Architect', sub: 'Gesperrt', status: 'locked', core: true },
      { id: 'qa', title: 'QA Strategist', sub: 'Qualitäts-Gates & Validierung', status: 'done' }
    ]},
    { id: 'tools', name: 'Tools-Ebene', sub: 'Verfügbare Fähigkeiten', icon: 'wrench', nodes: [
      { id: 'exec', title: 'Code Executor', sub: 'Läuft', status: 'active' },
      { id: 'gitm', title: 'Git Manager', sub: 'Bereit', status: 'ready' },
      { id: 'webs', title: 'Web Search', sub: 'Bereit', status: 'ready' }
    ]},
    { id: 'skills', name: 'Skills-Ebene', sub: 'Spezialisierte Fähigkeiten', icon: 'star', nodes: [
      { id: 'codegen', title: 'Codegenerierung', sub: 'Aktiv', status: 'ready' },
      { id: 'refactor', title: 'Refactoring', sub: 'Aktiv', status: 'ready' },
      { id: 'testd', title: 'Testentwurf', sub: 'Aktiv', status: 'ready' }
    ]},
    { id: 'memory', name: 'Memory-Ebene', sub: 'Memory-Streams & Wissen', icon: 'db', nodes: [
      { id: 'stm', title: 'Short-Term Memory', sub: 'Wird aktualisiert', status: 'active' },
      { id: 'ltm', title: 'Long-Term Memory', sub: 'Indiziert', status: 'ready' },
      { id: 'xtm', title: 'Cross-Task Memory', sub: 'Aktiv', status: 'ready' }
    ]},
    { id: 'decision', name: 'Entscheidungsebene', sub: 'Dynamische Planung & Verzweigung', icon: 'split', nodes: [
      { id: 'explore', title: 'Alternativen erkunden', sub: '2 Sub-Agent-Branches', status: 'ready' },
      { id: 'risk', title: 'Risikobewertung', sub: 'Bewertet Abwägungen', status: 'active' },
      { id: 'path', title: 'Ausführungspfad', sub: 'Ausgewählt & läuft', status: 'active' }
    ]}
  ],
  timeline: [
    { t: '10:24:31', title: 'Mission gestartet', detail: 'Benutzeranfrage empfangen und validiert', state: 'done' },
    { t: '10:24:45', title: 'Architekt gesperrt', detail: 'Senior-Code-Architekt initialisiert', state: 'done' },
    { t: '10:25:02', title: 'Planung abgeschlossen', detail: 'Aufgabenzerlegung und Rollenvergabe', state: 'done' },
    { t: '10:25:18', title: 'Sub-Agenten gestartet', detail: '8 Sub-Agenten in allen Ebenen aktiv', state: 'done' },
    { t: '10:27:03', title: 'Ausführung läuft', detail: 'Codegenerierung und Validierung im Gange', state: 'now' },
    { t: '10:31:00', title: 'Voraussichtlicher Abschluss', detail: '~3 Min. verbleibend', state: 'wait' }
  ],
  feed: [
    { who: 'Code Executor', text: '12 Tests ausgeführt', ago: 'vor 2,3 s', status: 'Läuft', color: '#5b9dff' },
    { who: 'Memory Stream', text: '18 neue Fakten indiziert', ago: 'vor 4,1 s', status: 'Aktualisiert', color: '#2ee6f0' },
    { who: 'QA Strategist', text: 'Teststrategie genehmigt', ago: 'vor 6,8 s', status: 'Analysiert', color: '#a78bfa' },
    { who: 'Git Manager', text: 'Checkpoint committet', ago: 'vor 9,2 s', status: 'Staging', color: '#3ee0a0' }
  ],
  schedule: [
    { name: 'Sicherheits-Scan', when: 'Täglich um 02:00', next: 'Als Nächstes: 02:00:18', icon: 'shield', color: '#5b9dff' },
    { name: 'Test Suite', when: 'Alle 4 Std.', next: 'Als Nächstes: 00:45:18', icon: 'beaker', color: '#3ee0a0' },
    { name: 'Abhängigkeitsprüfung', when: 'Wöchentlich Mo 03:00', next: 'Als Nächstes: 2 T 03:00:18', icon: 'alert', color: '#f5b942' },
    { name: 'Cache-Bereinigung', when: 'Täglich um 01:00', next: 'Als Nächstes: 1 T 01:00:18', icon: 'db', color: '#fb7185' }
  ],
  marketPreview: [
    { name: 'LangChain Connector', blurb: 'Verbindet sich mit LangChain-Runnables und -Agenten.', id: 'langchain' },
    { name: 'OpenTelemetry Exporter', blurb: 'Exportiert Traces und Metriken an OTLP-Endpunkte.', id: 'otel' },
    { name: 'Prompt Optimizer', blurb: 'Optimiert Prompts für Kosten und Leistung.', id: 'prompt' }
  ],
  tree: [
    { name: 'src', dir: true, children: [
      { name: 'services', dir: true, children: [
        { name: 'payment_service.py', path: 'src/services/payment_service.py' },
        { name: 'validation.py', path: 'src/services/validation.py' },
        { name: 'idempotency.py', path: 'src/services/idempotency.py' }
      ]},
      { name: 'models.py', path: 'src/models.py' }
    ]},
    { name: 'tests', dir: true, children: [
      { name: 'test_payment.py', path: 'tests/test_payment.py' }
    ]},
    { name: 'docs', dir: true, children: [] },
    { name: '.gitignore', path: '.gitignore' },
    { name: 'pyproject.toml', path: 'pyproject.toml' },
    { name: 'README.md', path: 'README.md' }
  ],
  files: {
    'src/services/payment_service.py': {
      lang: 'Python',
      crumb: 'src › services › payment_service.py › PaymentService › process_payment',
      suggestion: [
        '        # AI Suggestion (DeepSeek-V4-Pro)',
        '        # Using cached validation result if available.',
        '        cache_key = f"validate:{idempotency_key}"',
        '        if cached := self.cache.get(cache_key):',
        '            return cached',
        '        validation_result = self._validate_request(request)'
      ].join('\n'),
      body: [
        'class PaymentService:',
        '    def process_payment(self, request):',
        '        idempotency_key = request.idempotency_key',
        '        validation.validate(request)',
        '        self._validate_idempotency(idempotency_key)',
        '        result = self._execute_payment(request)',
        '        return result'
      ].join('\n')
    },
    'src/services/validation.py': {
      lang: 'Python',
      crumb: 'src › services › validation.py',
      body: [
        'def validate(request):',
        '    if not request.idempotency_key:',
        '        raise ValueError("idempotency_key required")',
        '    if request.amount <= 0:',
        '        raise ValueError("amount must be positive")',
        '    return True'
      ].join('\n')
    },
    'src/services/idempotency.py': {
      lang: 'Python',
      crumb: 'src › services › idempotency.py',
      body: [
        'class IdempotencyStore:',
        '    def __init__(self, cache):',
        '        self.cache = cache',
        '',
        '    def seen(self, key):',
        '        return self.cache.get(f"idem:{key}") is not None'
      ].join('\n')
    },
    'src/models.py': {
      lang: 'Python',
      crumb: 'src › models.py',
      body: [
        'class PaymentRequest:',
        '    def __init__(self, amount, idempotency_key, user_id):',
        '        self.amount = amount',
        '        self.idempotency_key = idempotency_key',
        '        self.user_id = user_id'
      ].join('\n')
    },
    'tests/test_payment.py': {
      lang: 'Python',
      crumb: 'tests › test_payment.py',
      body: [
        'def test_process_payment_uses_idempotency_key():',
        '    service = PaymentService()',
        '    request = PaymentRequest(1200, "key-1", "user-9")',
        '    assert service.process_payment(request).ok',
        '',
        'def test_rejects_missing_key():',
        '    service = PaymentService()',
        '    request = PaymentRequest(1200, "", "user-9")',
        '    with pytest.raises(ValueError):',
        '        service.process_payment(request)'
      ].join('\n')
    },
    '.gitignore': { lang: 'Text', crumb: '.gitignore', body: '.venv\n__pycache__/\n.pytest_cache/\n' },
    'pyproject.toml': { lang: 'TOML', crumb: 'pyproject.toml', body: '[project]\nname = "payment-service"\nversion = "0.4.17"\nrequires-python = ">=3.11"\n' },
    'README.md': { lang: 'Markdown', crumb: 'README.md', body: '# Payment Service\n\nIdempotent charges with structured logging and retries.\n' }
  },
  skills: [
    { name: 'Code Review', detail: 'Aktiv', state: 'Aktiv' },
    { name: 'File Editor', detail: 'Nimmt gezielte Änderungen vor', state: 'Aktiv' },
    { name: 'Test Runner', detail: 'Führt Regressionstests aus', state: 'Aktiv' },
    { name: 'Shell Executor', detail: 'Bereit für Befehle', state: 'Aktiv' },
    { name: 'Git Manager', detail: 'Staging auf dem Workspace-Branch', state: 'Aktiv' },
    { name: 'Code Explorer', detail: 'Analysiert die Struktur der Codebasis', state: 'Läuft' },
    { name: 'Static Analyzer', detail: 'Prüft auf Probleme', state: 'Läuft' },
    { name: 'Logger', detail: 'Erfasst strukturierte Logs', state: 'Läuft' },
    { name: 'PR Creator', detail: 'Wartet auf einen grünen Testlauf', state: 'Ausstehend' }
  ],
  plan: [
    { text: 'Aktuellen Zahlungsablauf analysieren', done: true },
    { text: 'Zahlungsvalidierungslogik extrahieren', done: false },
    { text: 'Behandlung von Idempotenz-Schlüsseln hinzufügen', done: false },
    { text: 'Tests und Dokumentation aktualisieren', done: false }
  ],
  workSteps: [
    { text: 'Analysiere aktuellen Zahlungsablauf', done: true },
    { text: 'Füge Retry-Logik mit exponentiellem Backoff hinzu', done: true },
    { text: 'Implementiere strukturiertes Logging', done: false },
    { text: 'Verbessere Fehlermeldungen', done: false },
    { text: 'Tests ausführen', done: false }
  ],
  messages: [
    {
      id: 'u1', role: 'user', time: '10:24 AM',
      text: 'Verbessere die Resilienz des Zahlungsablaufs durch Retries, strukturiertes Logging, bessere Fehlermeldungen und Tests.'
    },
    {
      id: 'a1', role: 'agent', time: '10:24 AM', progress: true,
      text: "Verstanden. Ich verbessere die Resilienz des Zahlungsablaufs Schritt für Schritt. Ich starte jetzt Analyse und Implementierung …",
      phase: 'Ausführung',
      checks: ['Plan erstellt', 'Lese Projektstruktur', 'Analysiere Zahlungsanforderungen', 'Erstelle Retry-Richtlinie'],
      tools: [{ name: 'explore_repository', args: 'max_depth=2' }, { name: 'read_file', args: 'path=src/services/payment_service.py' }]
    },
    {
      id: 'u2', role: 'user', time: '10:42 AM',
      text: 'Kannst du den Auth-Ablauf prüfen und Sicherheitsverbesserungen vorschlagen?'
    },
    {
      id: 'a2', role: 'agent', time: '10:43 AM',
      text: "Ich prüfe den Authentifizierungsablauf auf mögliche Sicherheitsprobleme. Einen Moment, während ich die Codebasis analysiere.",
      phase: 'Planung',
      reasoning: 'Login, Sitzungs-Cookies, Reset-Tokens und Logout sind die Flächen, über die Anmeldedaten auslaufen oder wiederverwendet werden können.',
      tools: [{ name: 'search_codebase', args: 'query=auth, file_pattern=**/*.py' }]
    },
    {
      id: 'u3', role: 'user', time: '10:45 AM',
      text: 'Prüfe auch auf fehlendes Rate Limiting oder fehlende Behandlung des Token-Ablaufs.'
    },
    {
      id: 'a3', role: 'agent', time: '10:47 AM', findings: true,
      text: 'Prüfung abgeschlossen. Ich habe einige Bereiche gefunden, die verbessert werden sollten:',
      bullets: [
        'Fehlendes Rate Limiting am Login-Endpunkt',
        'Access-Tokens laufen beim Logout nicht ab',
        'Passwort-Reset-Tokens sind nicht einmal verwendbar'
      ],
      ask: 'Soll ich eine Aufgabe mit empfohlenen Korrekturen anlegen?',
      phase: 'Prüfung',
      reasoning: 'Login-Route, Token-Speicher und Reset-Handler gegen die Testsuite geprüft. Bei diesen dreien keine Fehlalarme.'
    },
    {
      id: 'a4', role: 'agent', time: '10:44 AM',
      text: 'Lookup refaktoriert, damit er schnell scheitert und den verschachtelten Zweig entfernt.',
      code: {
        file: 'user_service.py',
        body: 'def get_user(self, user_id: str) -> User:\n    user = self.repo.fetch(user_id)\n    if user is None:\n        raise UserNotFound(user_id)\n    return user'
      }
    }
  ]
};
