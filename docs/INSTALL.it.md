# KYNEM — installa e richiama dalla chat

Per **Mac**, con **After Effects 2026** e **Codex desktop** già installati. Il pacchetto include bridge compilato e dipendenze; se manca Node.js compatibile, l’installer scarica un runtime privato da nodejs.org e ne verifica il checksum. Non serve usare npm o configurare MCP a mano.

## Una volta sola

1. Scarica [KYNEM-Mac-0.1.0-alpha.7.zip](https://github.com/AndreXes03/ae-agent-lab-alpha/releases/download/v0.1.0-alpha.7/KYNEM-Mac-0.1.0-alpha.7.zip), estrai lo ZIP e fai doppio clic su **Install KYNEM.command**. Attendi la conferma nel Terminale.
2. Se macOS blocca il launcher non firmato, usa la normale autorizzazione **Apri comunque** in Impostazioni di Sistema → Privacy e sicurezza, se disponibile. Non disattivare le protezioni del sistema.
3. Apri almeno una volta AE 2026 e abilita **Preferences → Scripting & Expressions → Allow Scripts to Write Files and Access Network**. Conferma gli eventuali permessi di automazione quando richiesti.
4. Apri una **nuova chat Codex**, digita `@` e seleziona **KYNEM**. Se l’elenco non si aggiorna, riavvia Codex; puoi anche richiamare la skill con `$kynem`.

L’installer salva i file in `~/Library/Application Support/KYNEM`. Dopo il completamento puoi eliminare la cartella estratta dallo ZIP. Non apre AE e non modifica i tuoi progetti. Serve internet se deve scaricare Node; l’account Codex resta quello dell’utente.

## Ogni volta che vuoi usarlo

Salva il tuo `.aep`, allegalo o indica il percorso nella chat e scrivi, per esempio:

> @KYNEM lavora su una copia di questo progetto. Nella comp Titolo ritarda l’ingresso del sottotitolo di 8 frame, lasciando invariato il resto. Mostrami il risultato.

L’agente avvia il bridge, crea una copia, controlla comp e layer, poi esegue la modifica richiesta. Non occorre avviare una demo o incollare blocchi di configurazione. Se la sessione esistente contiene un altro lavoro, l’agente si ferma prima di sostituirla.

La copia del `.aep` non raccoglie footage, font o plugin esterni: devono essere disponibili sul Mac destinatario. Le modifiche non ancora salvate nel progetto originale non sono incluse nella copia.

## Se qualcosa non funziona

- Conserva il messaggio completo dell’installer. Non avviare più installazioni contemporaneamente.
- Se KYNEM non compare, controlla che l’installazione sia terminata e apri una chat nuova dopo il riavvio di Codex.
- Se hai già un altro bridge AE installato, non sovrascrivere alla cieca la configurazione o lo script di avvio esistente: fai controllare il conflitto all’agente.
- In caso di timeout, fai verificare lo stato prima di ripetere: una modifica potrebbe essere stata eseguita.
- Per finire chiedi a KYNEM di salvare e fermare soltanto la propria sessione. Le copie restano sul disco. Vedi [disinstallazione](UNINSTALL.md).

**Alpha:** installer, configurazione e pacchetto ricevono verifiche locali/offline. La precedente prova nativa riguarda un Mac con AE 26.5. Il ciclo completo su altri Mac, incluso il menu `@`, va confermato dai tester. Il launcher non è firmato/notarizzato: le autorizzazioni iniziali di macOS e AE non possono essere eliminate dall’installer.
