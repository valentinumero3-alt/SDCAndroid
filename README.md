# SDCAndroid — SimpleDiscordCrypt pour Revenge Classic

Dépôt au format repository utilisé par Revenge Classic.

## Structure

```text
repo.json
builds/
  simplediscordcrypt/
    manifest.json
    index.js
```

## Installation

1. Remplace le contenu de ton dépôt GitHub `valentinumero3-alt/SDCAndroid` par le contenu de ce dossier.
2. Vérifie que `repo.json` est directement à la racine de la branche `main`.
3. Dans Revenge > Plugins > Install a plugin, utilise l'URL de base Raw GitHub avec un slash final :

```text
https://raw.githubusercontent.com/valentinumero3-alt/SDCAndroid/main/
```

Revenge récupérera ensuite automatiquement :

- `repo.json`
- `builds/simplediscordcrypt/manifest.json`
- `builds/simplediscordcrypt/index.js`

## Commandes SDC de cette version

- `:SDCSET <clé>` — associer une clé au salon courant
- `:SDCGEN` — générer une clé
- `:SDCON` / `:SDCOFF` — activer/désactiver dans le salon
- `:SDCSTATUS` — état du salon
- `:ENC message` — forcer le chiffrement
- `:NOENC message` — envoyer en clair

Cette première version Android cible les messages texte. Compression PNG, pièces jointes et échange automatique de clés ne sont pas encore portés.
