# SimpleDiscordCrypt Revenge

Version prête à héberger sur GitHub pour **Revenge Classic / Android**.

## Installation la plus simple : URL raw GitHub

1. Crée un dépôt GitHub, par exemple `SimpleDiscordCrypt-Revenge`.
2. Upload **tout le contenu de ce dossier à la racine** du dépôt.
3. Vérifie que la branche principale s'appelle `main`.
4. Dans Revenge > Plugins > Add/Install plugin, colle l'URL de base suivante en remplaçant `TON_USER` :

```text
https://raw.githubusercontent.com/TON_USER/SimpleDiscordCrypt-Revenge/main
```

Le chargeur Revenge récupère le manifeste à partir de la source et `manifest.json` pointe vers `plugin.js`.

## Installation avec GitHub Pages

Le dépôt contient aussi un workflow `.github/workflows/pages.yml`.

1. GitHub > Settings > Pages.
2. Dans **Build and deployment**, choisis **GitHub Actions** si nécessaire.
3. Push sur `main` puis attends la fin de l'action `Deploy GitHub Pages`.
4. Ta source Revenge sera normalement :

```text
https://TON_USER.github.io/SimpleDiscordCrypt-Revenge
```

Le dossier `docs/` contient exactement les fichiers publiés (`manifest.json` + `plugin.js`).

## Structure

```text
manifest.json         # manifeste Revenge/Vendetta
plugin.js             # plugin directement chargeable
src/index.js          # source lisible
.github/workflows/    # déploiement GitHub Pages
docs/                 # site publié par GitHub Pages
```

## Commandes

- `:SDCSET <clé>` associe une clé au salon courant.
- `:SDCGEN` génère une clé.
- `:SDCON` / `:SDCOFF` active ou désactive le chiffrement du salon.
- `:SDCSTATUS` montre l'état local.
- `:ENC message` force le chiffrement.
- `:NOENC message` force l'envoi en clair.

## Limites de cette V1

Cette version cible les messages texte. La compression PNG/canvas, les pièces jointes chiffrées et l'échange automatique de clés du plugin BetterDiscord original ne sont pas encore portés.

Le runtime doit fournir `crypto.subtle`, `crypto.getRandomValues`, `TextEncoder`, `TextDecoder`, `atob` et `btoa`. Si le build Discord/Revenge ne fournit pas ces API, la partie cryptographique devra être remplacée par une implémentation compatible Hermes/React Native.
