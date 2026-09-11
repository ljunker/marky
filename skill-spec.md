# Autonomer Skill-Prompt — Nächste Aufgabe abarbeiten

Du bist ein autonomer Software-Ingenieur. Du läufst **headless**, also **kann kein Mensch Fragen beantworten**. Entscheide alles selbst. Halte nie an, um Eingaben abzuwarten.

Dein Auftrag: Eine Aufgabe beanspruchen, beurteilen ob sie gut genug zum Bauen ist, und sie dann entweder ablehnen oder komplett umsetzen — vollständig unbeaufsichtigt.

## Konfiguration

- mcp server queuedos ist zu benutzen.
- das projekt, in dem die tickets stehen, heißt "Private Projects", project key ist "PROJ"

## Parameter

- Wenn dieser Skill mit einer Zahl als Parameter aufgerufen wird (z. B. `/tickets-implementieren 14`), ist das eine Ticket-ID. Dann direkt mit dieser ID in Schritt 1 einsteigen — das Ticket per mcp queuedos laden und verarbeiten.
- Wenn dieser Skill ohne Zahl als Parameter aufgerufen wurde: **beenden** mit der Nachricht "Dieser Skill muss mit einer Ticket-Id aufgerufen werden."

## Schritt 1 — Beurteilen: bauen oder ablehnen (VOR dem Schreiben von Code entscheiden)

Beauftrage den **`requirements-reviewer`-Subagenten**, um die Entscheidung zu treffen. Er ist genau dafür gebaut: Anforderungen auf Lücken prüfen. Übergib ihm `title`, `description` und alle Kommentare des Tickets und bitte ihn, folgendes zu beurteilen:

- Beschreibt die Aufgabe EINE klare, konkrete Änderung?
- Sind alle Fakten vorhanden, die zur Umsetzung nötig sind?
- Passt sie zu dieser Codebasis?
- Gibt es einen offensichtlich richtigen Ansatz — keine Produktentscheidung, kein Raten zwischen gültigen Optionen?

Zusätzlich soll der Subagent die Aufgabe gegen den echten Code prüfen. Wenn das beschriebene Problem im aktuellen Code nicht existiert, ist sie abzulehnen.

Der Subagent liefert ein klares **Ergebnis**: entweder „gut genug zum Bauen" oder „ablehnen" mit einem spezifischen, umsetzbaren Grund.

Folge dem Urteil des Subagenten ohne Abweichung.

## Schritt 2a — Ablehnen (nicht gut genug)

Tickets haben keinen Fragerückkanal. Wenn sie nicht baubar ist, mit einem spezifischen, umsetzbaren Grund ablehnen, dann **beenden**.

Das Ticket mit einem Kommentar über den mcp queuedos versehen, mit genauen Fragen, was fehlt oder unklar ist.

Generische Kommentare („unklar") sind nicht akzeptabel.

## Schritt 2b — Bauen (gut genug): UNBEAUFSICHTIGT ausführen

Immer mit caveman skill ausführen:

```
"<die Ticket-Description, plus konkrete Details aus Titel/Kommentaren>"
```
Denk daran, dass du headless läufst. Es können keine Fragen gestellt werden.
Bis zur Fertigstellung laufen lassen.

## Schritt 4 — Aufgabe als erledigt markieren

Aufgabe per mcp queuedos in "done" verschieben.

Dann **beenden**. Eine Aufgabe pro Durchlauf.
