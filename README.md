# Transcription ElevenLabs pour Valenced

Version 0.1.0 expérimentale, JS-only. Ce n'est pas une validation téléphone : les points de patch Discord et le transport React Native doivent encore être testés sur l'appareil. Aucun appel réel ElevenLabs n'a été exécuté pour cette livraison.

## Installer par dépôt (conseillé)

Dans Paramètres > Valenced > Plugins, ouvrir les paramètres de dépôts et ajouter cette URL d'index (pas l'URL de la page GitHub) :

https://raw.githubusercontent.com/Anezium/valenced-elevenlabs-transcription/main/index.json

Le dépôt contient « Transcription ElevenLabs (expérimental) ». Installer puis activer le plugin. Le canal `latest` de cet index vise explicitement 0.1.0 ; cela ne signifie pas que cette build est stable. La release GitHub est une prerelease expérimentale.

## Installer le ZIP directement (alternative)

Télécharger sans décompresser :
https://github.com/Anezium/valenced-elevenlabs-transcription/releases/download/v0.1.0/anezium.elevenlabs-transcription@0.1.0.zip

Paramètres > Valenced > Plugins > engrenage > Advanced > Install from file. Sélectionner le ZIP, confirmer, puis activer le plugin (désactivé par défaut). Un reload peut être nécessaire après mise à jour. Le ZIP source n'est PAS le ZIP plugin.

## Cible précise

Discord `352.6 (35220600000000) - canaryRelease`, détails `App: 352.6 (352206) canaryRelease`. Valenced affiché `1.0.0-d3e17fe (production)`, API native 1.0.0. Le manifest exige `discord =352.6` et `valenced.api =1.0.0` ; ces dépendances ne garantissent pas à elles seules un build canary identique. Une garde runtime vérifie Version, Build et ReleaseChannel, puis la forme/unicité des modules. En cas d'écart, aucun transfert n'est autorisé. Aucun upgrade demandé sur la seule base du numéro Valenced affiché.

## Usage et confidentialité

1. Dans les réglages du plugin, saisir la clé API ElevenLabs dans le champ masqué de l'app, jamais dans une conversation ou un rapport de bug.
2. La clé est en mémoire uniquement : la ressaisir après arrêt, reload ou passage en arrière-plan. Pas de stockage JSON, pas de Keystore, pas d'isolation vis-à-vis des autres plugins du client. Utiliser une clé restreinte et des plafonds de consommation adaptés.
3. Appui long sur un vocal déjà envoyé (le vôtre ou celui d'autrui), puis « Transcrire avec ElevenLabs ». Rien ne se déclenche à la réception ou à l'envoi d'un message.
4. Vérifier durée/taille et donner l'accord explicite de transfert, puis « Transcrire maintenant (coût possible) ». Ne transférer les voix d'autrui qu'avec l'autorisation nécessaire. L'audio va chez ElevenLabs : résultat affiché localement ne veut PAS dire traitement local.
5. Le résultat est dans une feuille locale avec copie volontaire. Aucun message Discord n'est envoyé, aucun brouillon modifié. Le presse-papiers reste géré par Android après copie.

Scribe v2 (`scribe_v2`), autodétection linguistique. Diarisation, multicanal, webhooks et événements audio désactivés. Aucun drapeau Enterprise de zéro rétention forcé : rétention et coût selon l'offre ElevenLabs. Plafonds applicatifs : 8 Mio et 5 minutes ; une seule transcription active, cache mémoire limité à 10 résultats. Pas de retry automatique d'un upload potentiellement facturé. Une annulation/erreur réseau ne garantit pas l'absence de facturation.

Le fichier est téléchargé depuis les CDN HTTPS Discord autorisés, vérifié, écrit dans un sous-dossier cache privé, envoyé en multipart puis supprimé dans `finally`. Ce dossier est purgé au prochain démarrage après crash ; une purge impossible bloque la fonction. Le transport RN/XHR ne garantit ni le blocage d'une redirection AVANT envoi au niveau natif, ni un plafond mémoire strict avant allocation ; les contrôles d'URL initiale/finale, de headers/progression et taille finale sont défensifs. Aucun token Discord n'est ajouté aux requêtes. Pour cette raison, cette build reste un test, pas un client durci pour environnement hostile.

## Premier smoke téléphone (encore à faire)

Sans clé : activation, diagnostic client/cache/menu, appui long sur vocal propre, vocal d'autrui et historique, ouverture/fermeture feuille, message texte ignoré, arrêt/reload sans doublon de menu. Aucun transfert ne doit partir sans clé + accord + clic final.

Ensuite seulement, si vous choisissez d'autoriser un appel potentiellement payant : un petit audio de test autorisé, confirmation, résultat/copie ; annulation, arrière-plan, oubli de clé, reload ; refus de clé/quota et URL expirée. L'UI doit afficher l'erreur sans exposer l'URL, la clé ou le contenu brut du fournisseur. Ne pas répéter un upload incertain sans accepter le risque de double facturation.

Rapport utile : version app/bundle et diagnostic du plugin uniquement. Ne pas exporter audio, message, identité, URL signée ou clé. Les erreurs internes inconnues sont remplacées par un message générique.

## Retour arrière

« Oublier la clé et les résultats / annuler », désactiver puis désinstaller le plugin. Les patches/listeners sont retirés à l'arrêt, le cache audio est nettoyé ; en cas d'échec de suppression, relancer le plugin pour la purge avant désinstallation. Effacer manuellement le presse-papiers si vous avez copié du texte. Aucun changement de Discord, des messages serveur ou de configuration système n'est requis.

## Compiler et vérifier

Node >=22.18 requis ; vérifié avec Node 22.21.1 et npm 10.9.4, sans Java/Gradle (aucune partie native). Depuis la racine du dépôt :

    npm ci --ignore-scripts --legacy-peer-deps
    npm run verify
    npm audit --audit-level=high

CLI officiel et types vendored avec révisions fixées, sources non modifiées et licences conservées (voir NOTICE et vendor-manifest.json). Le lockfile fixe les dépendances. `verify` exécute typecheck, tests unitaires/transport, compilation du CLI, bundling officiel Hermes, tests lifecycle sur le vrai JS compilé, packaging ZIP déterministe et génération/validation index par le CLI officiel. Résultat dans `dist/anezium.elevenlabs-transcription@0.1.0.zip`.

32 tests automatisés passent (27 core/transport + 5 lifecycle), uniquement des fixtures synthétiques injectées ; aucun audio utilisateur, aucun appel STT ni test Android ne sont représentés par ces résultats. Détails : VERIFICATION.md. La structure ZIP est réelle, mais l'installation et l'exécution dans Valenced sur téléphone restent à confirmer.

## Licence et sources

GPL-3.0-only, sans garantie. Adaptation de l'intégration menu des exemples communautaires Valenced, copyright des contributeurs conservé dans NOTICE. Les API React/React Native/Valenced sont externes au bundle. Sources complètes/build et licence dans ce dépôt/tag v0.1.0, archive source disponible à côté du ZIP dans la release. Aucun lien officiel avec Discord, Valenced ou ElevenLabs.
