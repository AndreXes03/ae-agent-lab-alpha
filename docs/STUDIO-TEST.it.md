# KYNEM — prova in studio

**Versione locale 0.1.0-alpha.3-studio.1.** Candidato di test successivo ad alpha.2, non una nuova release pubblicata. Il pacchetto contiene sorgenti e launcher per **macOS**: non è un installer autonomo e non include After Effects, Node.js o Codex. Il funzionamento nativo precedente è stato osservato su un solo Mac con AE 2026 (26.5); le nuove funzioni hanno controlli offline, non ancora una prova sul computer dello studio. Windows non è verificato né coperto da questi launcher.

## Preparazione una tantum

1. Sul Mac devono essere presenti **After Effects 2026**, **Node.js 24 o successivo con npm**, **Codex con CLI disponibile e accesso al tuo account**. Il primo avvio richiede internet per scaricare le dipendenze locali. L'uso del modello segue il tuo account Codex.
2. Estrai lo ZIP in una cartella stabile, per esempio `Documenti/KYNEM`. Non rinominarla o spostarla dopo il collegamento a Codex.
3. In AE abilita **Preferences → Scripting & Expressions → Allow Scripts to Write Files and Access Network**. Autorizza gli eventuali permessi macOS richiesti per controllare AE, se vuoi procedere. Non disattivare le protezioni di macOS.

## Prima prova

- Doppio clic su **Start Demo.command**. Controlla che il Terminale arrivi a sessione pronta: prepara il server e apre una copia della demo inclusa.
- Apri una **nuova chat Codex** e incolla il blocco **Ready-to-paste prompt** mostrato nel Terminale. Contiene worker e percorso della copia corretti per quel Mac.
- Chiedi una modifica piccola. L'agente deve salvare una variante, rileggere le proprietà e mostrarti il risultato renderizzato.

## Usare un progetto tuo

1. Salva il progetto di partenza. Se sposti il lavoro su un altro computer, trasferisci anche footage e asset, e verifica font e plugin necessari. Il launcher copia il `.aep`, **non raccoglie automaticamente i file collegati**.
2. Termina prima un'eventuale sessione di prova con **Stop Demo.command**. Poi fai doppio clic su **Start Project.command** e scegli il `.aep` salvato. Annullare la scelta non avvia AE.
3. Il launcher prepara una sessione separata con una copia del file. Incolla in una nuova chat il prompt stampato e aggiungi il tuo brief, ad esempio: “Nella comp Titolo sposta l'ingresso del sottotitolo di 8 frame, mantenendo il resto invariato. Verifica il risultato nella main comp”.
4. All'inizio chiedi interventi circoscritti: timing, keyframe, layer, varianti, anteprime. La qualità di un commercial creato da zero non è una capacità verificata.
5. L'agente deve identificare il progetto copiato, salvare una nuova variante, conservare il lavoro esterno al brief e controllare la **main comp effettiva**, non soltanto una precomp di prova.

**Non serve taggare la cartella `ae-agent-lab`.** Il collegamento viene registrato dal launcher come server MCP `ae-agent-lab-demo`; un link o una menzione della cartella dà contesto, non attiva AE. Se gli strumenti non compaiono, apri una nuova sessione Codex dopo il launcher e controlla il messaggio di avvio.

## Cosa cambia in questa versione

- `ae_motion_plan`, funzione offline: audit di campioni di posizione/scala e velocità ai raccordi, senza applicare modifiche.
- Preset di base distinti per testo, pannelli, icone e barre, riservati a layer nuovi non animati. Rifiutano target duplicati, keyframe/espressioni esistenti e dati incompatibili; separano preparazione dell'ancoraggio e rilettura della posizione.
- Procedura agente più precisa: verifica della main comp, rispetto della gerarchia di precomp, effetti confinati all'elemento richiesto, confronto prima/dopo e playback per giudicare il movimento.
- Questi controlli non sostituiscono il giudizio visivo. Non è stato pubblicato un aggiornamento automatico né modificato un progetto AE per verificare questa patch.

## Quando hai finito o compare un errore

Usa **Stop Demo.command** per salvare e fermare solo il worker della prova. Il collegamento Codex rimane per il riuso; [disinstallazione](UNINSTALL.md) descrive come rimuoverlo.

Se manca Node/Codex, il launcher lo segnala ma non li installa. Se erano installati tramite un gestore di versioni visibile solo nel Terminale, il doppio clic potrebbe non trovarli: conserva il messaggio e chiedi assistenza. Se esiste già una registrazione MCP diversa, non sostituirla alla cieca. In caso di timeout non ripetere subito la modifica: potrebbe essere stata eseguita. Riporta sistema operativo, versione AE, ultimo messaggio e punto della procedura; non condividere il progetto cliente se non necessario.
