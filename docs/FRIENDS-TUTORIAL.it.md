# Guida rapida per la demo KYNEM da sorgenti

Per installare KYNEM e usarlo sui tuoi progetti, segui la [guida installer](INSTALL.it.md). Questa procedura alternativa da sorgenti collega Codex a un worker separato di After Effects e lavora su una copia del progetto dimostrativo. La procedura è stata verificata su un solo Mac con After Effects 2026 (26.5).

## Prima di iniziare

- Mac con **After Effects 2026** installato.
- [**Node.js 24 o successivo**](https://nodejs.org/en/download) e **Codex** installati e già configurati sul Mac.
- Una connessione internet per il primo avvio e spazio libero per dipendenze, copie del progetto e render.

Scarica lo **ZIP dei sorgenti** (`KYNEM-Source-0.1.0-alpha.6.zip`) da [questa release GitHub](https://github.com/AndreXes03/ae-agent-lab-alpha/releases/tag/v0.1.0-alpha.6) e decomprimilo in una cartella stabile, per esempio `Documenti/AE Agent Lab`. Non spostare o rinominare la cartella durante la prova: Codex la userà per collegarsi al worker.

## Avvia la demo

1. Apri After Effects 2026. In **Preferences → Scripting & Expressions**, abilita **Allow Scripts to Write Files and Access Network**.
2. Nella cartella AE Agent Lab, fai doppio clic su **Start Demo.command**. Tieni aperta la finestra Terminale: prepara il collegamento, apre una copia del progetto Warm Glow e mostra i dettagli della sessione.
3. Se macOS chiede conferma per aprire il comando o per consentire a Terminale/Codex di controllare After Effects, leggi la richiesta e autorizza l’app indicata solo se vuoi proseguire. Se macOS blocca il file, fermati e chiedi aiuto: non disattivare Gatekeeper e non aggirare gli avvisi di sicurezza.
4. Attendi il messaggio di sessione pronta. Nel Terminale trovi il percorso assoluto della copia `.aep` e un blocco **Ready-to-paste prompt**.
5. Apri una **nuova chat Codex**. Incolla il prompt intero stampato dal comando: contiene già il worker e il percorso effettivo della copia sul tuo Mac. Non sostituire quei percorsi con esempi o con il progetto originale.

## Prova una piccola modifica

Quando la chat ha ispezionato il progetto, puoi chiederle di fare una modifica circoscritta al timing del lampo di esposizione già presente. Per esempio:

> Sul progetto copiato, sposta il picco del lampo di esposizione a 2,2 secondi e il punto di assestamento a 3,0 secondi. Prima salva una nuova variante nella cartella di questa sessione; conserva i valori e il resto dell'animazione. Rileggi i keyframe dopo la modifica, salva e renderizza i fotogrammi a 2,2 e 3,0 secondi. Apri e controlla i render, poi indicami i percorsi della variante e delle immagini. Se non puoi identificare con certezza il parametro, fermati e dimmi cosa hai trovato.

La chat deve usare il worker `ae-agent-lab-demo` e la copia indicata dal prompt. Controlla che salvi una **nuova variante** prima di modificare, poi che mostri i render effettivi e riferisca i percorsi. La prova è conclusa solo dopo aver guardato le immagini, non quando il render è soltanto in coda.

## Chiudi la sessione

Quando hai finito, fai doppio clic su **Stop Demo.command** e attendi il messaggio di completamento prima di chiudere Terminale. Il comando salva e ferma il worker della demo. La chat e il collegamento locale restano configurati per un eventuale riutilizzo.

## Se qualcosa non va

- **Il comando non parte o segnala un prerequisito:** controlla Node.js 24 o successivo, Codex e la cartella stabile; lascia visibile Terminale e copia il messaggio d’errore.
- **La chat non vede gli strumenti:** avvia una nuova chat Codex dopo `Start Demo.command`; verifica che il launcher abbia mostrato la sessione pronta.
- **After Effects non risponde o compare una richiesta di permesso:** controlla la preferenza Scripting indicata sopra e le richieste macOS. Non ripetere alla cieca un’azione che sembra essersi bloccata; annota l’ultimo stato visibile.
- **Il progetto o i render non corrispondono:** interrompi la modifica. Condividi il testo del Terminale, il percorso della copia stampato e ciò che la chat ha riportato.

## Condividi un riscontro

Puoi usare il [modulo GitHub per i tester](https://github.com/AndreXes03/ae-agent-lab-alpha/issues/new/choose) oppure copiare e compilare questo messaggio:

```text
Mac / versione macOS:
Versione After Effects:
Versione Node.js:
Avvio completato? (sì/no):
Chat Codex ha visto il worker? (sì/no):
Modifica e controllo dei render riusciti? (sì/no):
Percorso della variante e dei render:
Errore o punto in cui ti sei fermato:
Cosa è stato chiaro o poco chiaro:
```

Per questa prima prova usa il progetto Warm Glow incluso. Aprire una copia di un proprio progetto è una possibilità sperimentale: file collegati, font e plugin non vengono raccolti automaticamente e questa strada non è stata verificata con progetti esterni.
