# Transcription ElevenLabs pour Valenced — préversion de test

Version `0.2.0-dev`, expérimentale, NON validée sur Android et NON validée de bout en bout avec ElevenLabs/Discord. La distribution n'est pas une certification appareil ni une version stable. La version `0.1.0` reste disponible, sans remplacement de son tag ni de ses assets.

## Dépôt et mise à jour

Conserver exactement l'index déjà ajouté dans Valenced :

https://raw.githubusercontent.com/Anezium/valenced-elevenlabs-transcription/main/index.json

Le canal `latest` pointe volontairement vers `0.2.0-dev`, tout comme `testing` et `beta`. Il désigne ici la préversion de test, PAS une version stable. L'updater hôte suit le canal enregistré pour ce dépôt ; la version 0.2.0-dev est supérieure à 0.1.0 selon son comparateur. Aucun nouvel index ni changement d'URL n'est nécessaire. Une installation ancienne depuis fichier peut ne pas suivre le dépôt : vérifier sa source dans les réglages des plugins.

Dans Paramètres > Valenced > Plugins, actualiser les dépôts puis vérifier la mise à jour proposée et la confirmer. Un reload peut être nécessaire. Aucun de ces gestes n'a été effectué sur téléphone pour cette publication ; la présentation exacte dépend de l'hôte.

Alternative, ZIP plugin sans décompression :
https://github.com/Anezium/valenced-elevenlabs-transcription/releases/download/v0.2.0-dev/anezium.elevenlabs-transcription@0.2.0-dev.zip

Le ZIP source n'est PAS installable comme plugin. SHA256 du ZIP plugin (48 205 octets) :
`3329dca5b8ba06ef276e1b62a4cf0ae4001217e98e1515800fd52ca4bbeca08f`.

## Cible et bridge natif

Discord `352.6 (35220600000000) - canaryRelease`, détails `App: 352.6 (352206) canaryRelease`. Source Valenced cible `d3e17fe0416c3dc5f4b4d783b465eeb4a99caec1`, API `1.0.0`. Les dépendances sont strictes : `discord =352.6`, `valenced.api =1.0.0`, complétées par des gardes runtime et unicité/forme des modules.

Le même ZIP inclut `index.js` ET `elevenlabs.jar` contenant du DEX. Le manifest déclare `dist.android.path` et `dist.android.class` ; le chargeur officiel sait charger ce PluginBuilder depuis un plugin externe. Aucun APK modifié ou bridge installé séparément n'est requis par ce contrat source. Ce n'est PAS une preuve d'exécution de ce bridge sur le téléphone de l'utilisateur. Absence de bridge, contexte ou module attendu = refus fermé, pas de stockage en clair de secours.

## Fonctions et consentements

- Clé : champ masqué dans les réglages, enregistrement/suppression par le bridge Android ; AES-256-GCM, clé AndroidKeyStore non exportable, ciphertext/IV dans noBackupFilesDir via AtomicFile. Ne jamais donner sa clé dans un chat/rapport. La persistance après arrêt de processus Android reste à vérifier sur appareil.
- Action manuelle conservée pour un vocal existant, avec accord de traitement externe/coût. L'insertion dans le groupe natif est refusée si sa structure n'est pas reconnue ; position/icône réelles non validées.
- Automatisation désactivée par défaut. Accords explicites distincts pour transfert/coût et publication de ses propres transcriptions. Enregistrer la clé n'active pas ces accords et ne vérifie pas la clé chez le fournisseur.
- Nouveaux vocaux frais dans le canal sélectionné uniquement ; pas de collecte d'historique ni de catch-up. Autrui : rendu local dans le chat, jamais publié par le plugin. Vos vocaux SENT : réponse texte référencée dans le canal d'origine après activation explicite, mentions désactivées.
- File bornée, contrôle de permissions avant coût et envoi, déduplication durable. Au plus une tentative automatique, PAS garantie de livraison exactement une fois. Journal limité à 1024 réservations, saturation = arrêt fermé, sans rotation automatique.

## Confidentialité et limites

Un résultat local n'est pas un traitement local : l'audio est envoyé à ElevenLabs, potentiellement payant. Scribe v2, rétention/coût selon l'offre fournisseur ; aucune promesse de zéro rétention. Autorisation des personnes concernées requise. Plafonds applicatifs : 8 Mio / 5 minutes ; cache mémoire de 10 résultats, file automatique 8 en attente + 1 actif, 3 tentatives/minute.

La protection Keystore concerne le repos, pas l'isolation entre plugins du même UID/processus ni une garantie matérielle. La clé reste en mémoire pendant le traitement. Le transport RN/XHR ne garantit ni blocage natif préalable de toute redirection ni plafond mémoire strict avant allocation. Nettoyage du cache en finally et au démarrage ; échec de purge = refus fermé. Aucun token Discord ajouté au transport audio/STT.

Arrière-plan, arrêt, changement de clé/compte/canal ou révocation invalident les travaux en cours. Une requête déjà émise ne peut être rappelée ; coût ou publication déjà engagés restent possibles. Si le disque refuse une révocation, elle vaut pour la session mais les anciens accords peuvent réapparaître après crash/restart : l'UI avertit, réessayer avant de quitter. Ne pas relancer automatiquement un envoi incertain.

## Vérifications et réserves

Rebuild du candidat exact : typecheck, 56 tests TS, 49 tests du vrai bundle avec hôte synthétique, 2 probes UI supplémentaires, 41 assertions JVM, compilation contre API hôte réelle, Kotlin et D8 réussis. Audit vendor/secrets et provenance Fable vérifiés ; npm audit sans vulnérabilité signalée. Un scan de motifs n'est pas une preuve absolue d'absence de secrets.

UI générée réellement par `claude-fable-5-1` / effort high sans substitution ; son run s'est terminé sur HTTP429, pas sur un succès final. Les corrections et le build ont été vérifiés indépendamment.

NON vérifiés : AndroidKeyStore/AtomicFile sur appareil, arrêt/rechargement Android réel, menu 352.6, rendu visuel/mobile/TalkBack, hooks client réels et vraie réponse Discord. Aucun appareil installé, audio utilisateur, appel STT payant ni POST Discord exécuté dans cette publication. Les tests synthétiques ne prouvent aucun de ces points. La validation finale v0.2 reste ouverte ; tout test réel demande un accord séparé.

## Arrêt et retour arrière

Désactiver les modes automatiques puis utiliser « Supprimer la clé » avant de désinstaller le plugin. Le coffre et l'alias Keystore peuvent survivre à la désinstallation du seul plugin. Pas de promesse d'effacement forensic. Nettoyer le presse-papiers si un résultat a été copié ; les messages déjà publiés ne sont pas retirés automatiquement.

Le canal `legacy` conserve 0.1.0, ainsi que le téléchargement original :
https://github.com/Anezium/valenced-elevenlabs-transcription/releases/download/v0.1.0/anezium.elevenlabs-transcription@0.1.0.zip

Un downgrade peut nécessiter une sélection manuelle de version selon l'hôte ; il n'est pas testé ici. Ne pas supprimer des données pour contourner une erreur.

## Build et sources

Node >=22.18 (vérifié 22.21.1), Python >=3.11. Toolchain locale uniquement, voir V020_TECHNICAL.md et scripts/setup-native.py pour versions/hashes/licences. Obtenir la source officielle Valenced au commit cible et définir VALENCED_SOURCE vers son checkout.

    python3 scripts/setup-native.py
    npm ci --ignore-scripts --legacy-peer-deps
    npm run verify
    node scripts/audit-dev.mjs
    npm audit --audit-level=high

Sortie : `dist/anezium.elevenlabs-transcription@0.2.0-dev.zip`. `verify` ne modifie pas l'index public. Le CLI officiel génère l'index à partir des ZIP et des canaux explicites dans repo.config.json. PREVIEW_020.md documente les contrôles de distribution. V020_TECHNICAL.md et V020_DIAGNOSTIC.md conservent l'historique des étapes, pas l'état courant d'autorisation.

GPL-3.0-only, sans garantie ; attributions dans NOTICE, API externes et sources vendored épinglées. Aucun lien officiel avec Discord, Valenced ou ElevenLabs.
