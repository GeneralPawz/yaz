# Deutsche Übersetzung. en-US.ftl ist die Quelle der Wahrheit für Nachrichten-
# schlüssel; fehlt hier einer, greift die Kette (de-AT → de-DE → en-US), statt
# den rohen Schlüssel anzuzeigen.
#
# Anrede: unpersönlich, wo es geht ("Ordner öffnen…"), sonst Sie-Form. Fachwörter
# aus dem LaTeX- und Zotero-Umfeld bleiben englisch, weil sie in der Praxis so
# heißen — "Preamble" wird zu "Präambel", "SyncTeX" bleibt SyncTeX.
#
# Siehe docs/adr/0011-localisation.md

## Anwendung

app-name = yaz
app-tagline = Aus Ideen und Quellen werden Aufsätze.

## Dateisystemfehler — Schlüssel aus yaz-core::Error::message_key()

error-fs-not-found = { $path } wurde nicht gefunden.
error-fs-outside-root = { $path } liegt außerhalb von { $root }, worauf dieser Vorgang beschränkt ist.
error-fs-undecodable = { $path } ließ sich nicht als Text lesen. Möglicherweise ist es eine Binärdatei oder verwendet eine nicht unterstützte Kodierung.
error-fs-conflicting-write = { $path } wurde außerhalb von yaz geändert, seit Sie es geöffnet haben. Jetzt zu speichern würde diese Änderungen verwerfen.
error-fs-io = Beim Lesen oder Schreiben von { $path } ist etwas schiefgegangen.

## Übersetzung des Dokuments

compile-run = Übersetzen
compile-running = Wird übersetzt…
compile-succeeded = In { $seconds } s übersetzt.
compile-failed = Übersetzung fehlgeschlagen.
compile-diagnostics-count = { $count } Fehler
compile-diagnostics =
    { $count ->
        [one] 1 Problem
       *[other] { $count } Probleme
    }
compile-engine-unavailable = Dieses Projekt ist auf { $engine } eingestellt, was nicht installiert ist. Installieren Sie eine TeX-Distribution oder stellen Sie das Projekt auf die eingebaute Tectonic-Engine um.

## Engines

settings-engine = Engine
settings-engine-help = Wird in yaz.toml gespeichert, damit Mitautorinnen und Mitautoren genauso übersetzen wie Sie.
engine-tectonic-not-built = In dieser yaz-Fassung nicht enthalten. Sie muss einkompiliert werden — eine Einstellung kann sie nicht nachrüsten.
engine-system-not-installed = Auf diesem Rechner nicht installiert.
engine-unavailable-suffix = nicht verfügbar

## Zotero — Schlüssel aus yaz-zotero::ActiveSource::status_key()

zotero-source-better-bibtex = Zotero: über Better BibTeX verbunden
zotero-source-local-api = Zotero: verbunden
zotero-source-exported-bib = Zotero: offline — es wird eine exportierte .bib gelesen
zotero-source-sqlite = Zotero: offline — die Bibliotheksdatenbank wird gelesen
zotero-source-none = Zotero: nicht verfügbar
zotero-keys-generated = Die Zitationsschlüssel stammen von yaz, weil Better BibTeX nicht verfügbar ist. Sie können von denen Ihrer Mitautorinnen und Mitautoren abweichen.

## Plugin-Berechtigungen — Schlüssel aus
## yaz-plugin::Capability::description_key()

capability-fs-project-description = Dateien in diesem Projekt lesen und ändern.
capability-fs-read-description = Dateien an einem bestimmten Ort außerhalb dieses Projekts lesen.
capability-fs-write-description = Dateien an einem bestimmten Ort außerhalb dieses Projekts ändern.
capability-net-description = Ins Internet gehen, beschränkt auf { $hosts }.
capability-process-description = Programme auf Ihrem Rechner ausführen: { $binaries }.
capability-zotero-description = Ihre Zotero-Bibliothek lesen.
capability-obsidian-description = Ihren Obsidian-Vault lesen.
capability-clipboard-description = Die Zwischenablage lesen und ändern.
capability-notifications-description = Systembenachrichtigungen anzeigen.
capability-shell-open-description = Links und Dateien mit Ihren anderen Anwendungen öffnen.

## Plugin-Verwaltung

plugin-install-title = { $name } installieren?
plugin-install-capabilities = Dieses Plugin verlangt:
plugin-install-unreviewed = Dieses Plugin wurde von niemandem geprüft. Installieren Sie nur Plugins von Anbietern, denen Sie vertrauen.
plugin-update-new-capabilities = { $name } verlangt Rechte, die es vorher nicht hatte. Prüfen Sie sie vor dem Aktualisieren.
plugin-error = { $name } funktioniert nicht mehr.
plugin-error-disable = { $name } deaktivieren

## Arbeitsbereich

workspace-open-project = Ordner öffnen…
workspace-no-project = Noch kein Ordner geöffnet.
workspace-no-files = Keine .tex-Dateien in diesem Ordner.
workspace-no-file-open = Wählen Sie eine Datei, um zu schreiben.
workspace-entry = Hauptdatei

## Editor

editor-mode-source = Quelltext
editor-mode-visual = Visuell
editor-vim-mode = Vim
editor-loading = Wird geöffnet…

## PDF

pdf-empty = Übersetzen Sie das Dokument, um es hier zu sehen.

## Einstellungen

settings-appearance = Erscheinungsbild
settings-theme = Theme
settings-colour-mode = Farbmodus
settings-colour-mode-system = Wie das System
settings-colour-mode-light = Hell
settings-colour-mode-dark = Dunkel
settings-interface-locale = Sprache der Oberfläche
settings-document-locale = Sprache des Dokuments
settings-document-locale-help = Die Sprache, in der Sie schreiben. Unabhängig von der Oberfläche — sie steuert Rechtschreibprüfung, Silbentrennung und Anführungszeichen.
settings-check-for-updates = Nach Aktualisierungen suchen
settings-check-for-updates-help = Fragt bei GitHub nach, ob es eine neuere Fassung gibt.

## Auswahllisten

picker-placeholder = Tippen zum Filtern
picker-empty = Nichts anzuzeigen
picker-loading = Wird geladen…
picker-failed = Die Liste konnte nicht geladen werden

## Plugin-Laufzeit

plugin-error-not-loaded = Dieses Plugin ist nicht geladen.
capability-error-not-declared = Das Plugin hat dafür keine Erlaubnis verlangt.
capability-error-not-granted = Sie haben dem Plugin dafür keine Erlaubnis erteilt.
capability-error-out-of-scope = Das liegt außerhalb dessen, was das Plugin erreichen darf.

## Zotero — Befehle

zotero-command-cite = Aus Zotero zitieren
zotero-command-cite-description = Ihre Zotero-Bibliothek durchsuchen und eine Zitation einfügen.
zotero-command-quote = Markierte Stelle zitieren
zotero-command-quote-description = Eine in Zotero markierte Stelle samt Zitation einfügen.
zotero-command-reconnect = Erneut mit Zotero verbinden
zotero-command-reconnect-description = Erneut nach einem laufenden Zotero suchen und sonst auf die Bibliothek auf der Festplatte zurückfallen.

## Zotero — Auswahllisten

zotero-picker-source-title = Quelle wählen
zotero-picker-source-placeholder = Nach Titel oder Autorin suchen
zotero-picker-source-empty = Nichts in Ihrer Bibliothek passt dazu
zotero-picker-passage-title = Markierte Stelle wählen
zotero-picker-passage-placeholder = Stellen filtern
zotero-picker-passage-empty = Keine Stelle passt dazu
zotero-page-label = S. { $page }

## Zotero — Hinweise

zotero-notice-no-editor = Öffnen Sie zuerst ein Dokument.
zotero-notice-unavailable = Unter { $detail } wurde keine Zotero-Bibliothek gefunden.
zotero-notice-no-annotations = In dieser Quelle haben Sie nichts markiert.
zotero-notice-no-quotable-annotations = Diese Quelle enthält Markierungen, aber keine davon ist zitierbarer Text.
zotero-notice-generated-key = { $key } eingefügt. Dieser Schlüssel stammt von yaz und kann von dem Ihrer Mitautorinnen und Mitautoren abweichen.

## Zotero — Arten von Markierungen

zotero-annotation-highlight = Hervorhebung
zotero-annotation-note = Notiz
zotero-annotation-image = Bild
zotero-annotation-ink = Zeichnung
zotero-annotation-underline = Unterstreichung
zotero-annotation-other = Sonstiges

## Zotero — wo die Bibliothek gefunden wurde

zotero-datadir-configured = dem Ordner, den Sie gewählt haben
zotero-datadir-profile = dem Ordner, auf den Ihr Zotero-Profil zeigt
zotero-datadir-convention = dem üblichen Zotero-Ordner

## Zotero — Fehler

zotero-error-no-library = Es wurde keine Zotero-Bibliothek gefunden.
zotero-error-unsupported-schema = Diese Zotero-Bibliothek stammt von einem neueren Zotero, als yaz versteht, und wurde deshalb nicht gelesen.
zotero-error-unsupported-journal = Diese Zotero-Bibliothek legt die letzten Änderungen getrennt ab; yaz hätte nur einen veralteten Stand gelesen.
zotero-error-not-running = Zotero läuft nicht.
zotero-error-unexpected-response = Zotero hat auf eine Weise geantwortet, die yaz nicht versteht.
zotero-error-http = Zotero war nicht erreichbar.
zotero-error-database = Ihre Zotero-Bibliothek ließ sich nicht lesen.
zotero-error-io = Eine Datei ließ sich nicht lesen oder schreiben.
zotero-error-item-not-found = Dieser Eintrag ist nicht mehr in Ihrer Zotero-Bibliothek.

## Zotero — die laufende Verbindung

zotero-live-available = Mit Zotero verbunden
zotero-live-not-running = Zotero läuft nicht
zotero-live-api-disabled = Zotero läuft, aber seine lokale Schnittstelle ist ausgeschaltet
zotero-live-api-disabled-help = Schalten Sie in Zoteros erweiterten Einstellungen „Anderen Anwendungen auf diesem Computer erlauben, mit Zotero zu kommunizieren“ ein, um die Bibliothek live zu lesen.
zotero-live-unexpected = Zotero hat unerwartet geantwortet
zotero-demoted = Die Live-Verbindung ist ausgefallen; die Bibliothek wird aus einer Kopie auf der Festplatte gelesen.

## Menüleiste

menu-file = Datei
menu-edit = Bearbeiten
menu-view = Ansicht
menu-tools = Werkzeuge
menu-help = Hilfe

menu-file-open-folder = Ordner öffnen…
menu-file-save = Speichern
menu-file-compile = Übersetzen
menu-file-close-project = Projekt schließen
menu-edit-undo = Rückgängig
menu-edit-redo = Wiederherstellen
menu-edit-find = Suchen…
menu-view-vim = Vim-Tasten
menu-view-connections = Verbindungen
menu-tools-engine = Satz-Engine
menu-help-documentation = Dokumentation
menu-help-report-issue = Problem melden
menu-help-about = Über yaz
menu-not-implemented = Das ist noch nicht gebaut.

## Verbindungen

connections-title = Verbindungen
connections-none = Es ist noch nichts eingerichtet.
connections-reconnect = Neu verbinden
connections-zotero = Zotero
connections-obsidian = Obsidian
connections-not-configured = Nicht eingerichtet
connections-reading-offline = Es wird eine Kopie der Bibliothek von der Festplatte gelesen
connections-source = Quelle: { $source }

## Fensterschaltflächen

window-minimise = Minimieren
window-maximise = Maximieren
window-restore = Wiederherstellen
window-close = Schließen

## Einstellungen

settings-title = Einstellungen
settings-section-general = Allgemein
settings-section-engine = Satz
settings-section-connections = Verbindungen
settings-group-editor = Editor
settings-group-typesetting = Engine
settings-vim-help = Modales Bearbeiten, im Quelltext wie in der visuellen Ansicht.
settings-engine-no-project = Öffnen Sie ein Projekt, um seine Engine zu wählen. Die Wahl wird pro Projekt gespeichert.

## Verbindungen, Fortsetzung

connections-unknown = Noch nicht verbunden
connections-connect-zotero = Mit Zotero verbinden
connections-reconnect-zotero = Erneut mit Zotero verbinden
menu-tools-connections = Verbindungen
menu-edit-settings = Einstellungen…

## Arbeitsbereich

workspace-close-tab = Reiter schließen
workspace-tab-editor = Quelltext
workspace-tab-pdf = PDF
menu-view-tabs = Reiter
menu-view-reset-layout = Anordnung zurücksetzen

## Menü „Datei“, Fortsetzung

menu-file-open-recent = Zuletzt geöffnet
menu-file-no-recent = Keine zuletzt geöffneten Projekte
compile-start = Übersetzen

## Versionsverwaltung

vcs-title = Versionsverlauf
vcs-enable = Versionen aufzeichnen
vcs-disable = Versionen nicht mehr aufzeichnen
vcs-recording = Versionen werden aufgezeichnet
vcs-not-recording = Versionen werden nicht aufgezeichnet
vcs-unavailable = Auf diesem Rechner ist keine Versionsverwaltung verfügbar
vcs-backend-git = Git
vcs-backend-builtin = In yaz eingebaut (noch nicht fertig)
vcs-settings-backend = Aufzeichnung mit
vcs-settings-backend-help = Git nutzt Ihr eigenes Repository, sodass Branches, Remotes und Hooks weiter funktionieren. Die Versionsverwaltung auszuschalten löscht nie etwas.
vcs-commit-with-message = Version mit eigener Beschreibung speichern…
vcs-commit-placeholder = Was sich geändert hat, und warum
vcs-commit-title = Version speichern
vcs-commit-hint = Lassen Sie das Feld leer, dann beschreibt yaz die Änderungen für Sie.
vcs-committed = Version { $id } gespeichert
vcs-nothing-to-commit = Seit der letzten Version hat sich nichts geändert.
vcs-restore = Diese Version wiederherstellen
vcs-restored = { $id } wiederhergestellt. Speichern Sie eine Version, um sie zu behalten.
vcs-empty = Noch keine Versionen aufgezeichnet.
vcs-uncommitted = Sie haben ungespeicherte Änderungen.
vcs-off-explains = Schalten Sie die Versionsverwaltung ein, um einen Verlauf dieses Projekts zu behalten.
vcs-error-unavailable = Diese Versionsverwaltung ist nicht installiert.
vcs-error-not-initialised = Dieses Projekt steht nicht unter Versionsverwaltung.
vcs-error-would-lose-changes = Speichern Sie zuerst eine Version — das Wiederherstellen würde Änderungen überschreiben, die nirgends aufgezeichnet sind.
vcs-error-not-implemented = Diese Versionsverwaltung ist noch nicht gebaut.
vcs-error-tool = Die Versionsverwaltung hat ein Problem gemeldet.
vcs-error-io = Eine Datei ließ sich nicht lesen oder schreiben.
vcs-error-unknown-backend = Unbekannte Versionsverwaltung.
workspace-tab-history = Verlauf

## Formatierte Ansicht und Gliederung

menu-view-rich-text = Formatierte Ansicht
workspace-tab-outline = Gliederung
outline-empty = Noch keine Überschriften. Fügen Sie ein \section ein, um die Gliederung zu sehen.
outline-untitled = Abschnitt ohne Titel

## Die Marken, die den Text einfassen

editor-text-start = Anfang des Textes
editor-text-end = Ende des Textes
editor-wrapper-show = Das LaTeX um den Text zeigen
editor-wrapper-hide = Das LaTeX um den Text verbergen

## Ansichten und Zeilennummern

view-mode-rich = Formatierte Ansicht
view-mode-source = Quelltext
view-mode-show-rich = Das Dokument so zeigen, wie es gelesen wird
view-mode-show-source = Den LaTeX-Quelltext zeigen
menu-view-line-numbers = Zeilennummern
menu-view-line-numbers-off = Keine
menu-view-line-numbers-absolute = Absolut
menu-view-line-numbers-relative = Relativ

## Die Dateiliste

menu-view-files = Dateiliste
files-pin = Dateiliste offen halten
files-unpin = Dateiliste einklappen lassen

## Vom PDF zurück in den Quelltext

synctex-outside-project = Das stammt aus { $path } und liegt außerhalb dieses Projekts.

## Erscheinungsbild

settings-theme-help = Ein Theme bringt Hell und Dunkel mit.
settings-interface-locale-help = Die Sprache des Dokuments selbst ist eine Projekteinstellung und wird getrennt gesetzt.
settings-appearance-build = Theme bauen
settings-appearance-build-help = Vom aktuellen Theme ausgehen und ändern, was Ihnen gefällt.
settings-appearance-build-open = Theme bauen…
settings-appearance-install = Theme installieren…
theme-error-manifest = Dieser Ordner enthält kein Theme.
theme-error-modes = Ein Theme muss Hell und Dunkel mitbringen.
theme-installed = { $name } installiert.
theme-exported = Nach { $path } geschrieben.

## Der Theme-Baukasten

theme-builder-title = Theme-Baukasten
theme-builder-name = Name
theme-builder-author = Autorin oder Autor
theme-builder-mode-light = Hell
theme-builder-mode-dark = Dunkel
theme-builder-editing = Sie bearbeiten die { $mode }-Palette. Das Fenster zeigt sie mit.
theme-builder-apply = Dieses Theme verwenden
theme-builder-export = Exportieren…
theme-builder-reset = Von vorn anfangen
theme-builder-close = Schließen
theme-group-surfaces = Flächen
theme-group-text = Text
theme-group-accent = Akzent
theme-group-state = Zustände
theme-group-borders = Ränder
theme-group-editor = Editor
theme-group-syntax = Syntaxhervorhebung
theme-group-pdf = PDF-Ansicht
theme-token-bg-primary = Hintergrund
theme-token-bg-secondary = Bereiche
theme-token-bg-tertiary = Erhöhte Flächen
theme-token-bg-overlay = Dialoge
theme-token-text-primary = Text
theme-token-text-secondary = Nebentext
theme-token-text-muted = Gedämpfter Text
theme-token-accent = Akzent
theme-token-accent-hover = Akzent, überfahren
theme-token-text-on-accent = Text auf Akzent
theme-token-success = Erfolg
theme-token-warning = Warnung
theme-token-error = Fehler
theme-token-border = Ränder
theme-token-border-strong = Kräftige Ränder
theme-token-editor-bg = Editor-Hintergrund
theme-token-editor-gutter-bg = Randspalte
theme-token-editor-cursor = Schreibmarke
theme-token-syntax-command = Befehle
theme-token-syntax-environment = Umgebungen
theme-token-syntax-math = Mathematik
theme-token-syntax-comment = Kommentare
theme-token-syntax-string = Zeichenketten
theme-token-syntax-reference = Verweise
theme-token-pdf-bg = Fläche um die Seite
