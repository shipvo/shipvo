# Build your first Shipvo app

Vingt minutes pour passer de rien à une application que des agents IA peuvent ouvrir dans un simulateur, qui s'installe sur un téléphone Android, et que vous mettez à jour over the air avec une seule commande, `shipvo publish`.

## 0. What you need

- Node 22 et npm (ou pnpm / bun).
- Pour le simulateur : Chromium via Playwright (une commande ci-dessous). Pas d'Android Studio, pas de Xcode, pas de téléphone.
- Pour les téléphones : Android Studio une fois (`npx expo run:android`), ou EAS Build.
- Pour publier : un control plane. Utilisez celui hébergé (`shipvo login`, puis `shipvo app create`, tous deux ci-dessous) ou auto-hébergez le vôtre sur Cloudflare en dix minutes ([self-hosting.md](self-hosting.md)).

## 1. Create the app

```bash
npx -y @shipvo/cli init myshop --name "My Shop"
cd myshop
npm install
npx playwright install chromium
```

`init` écrit une application Expo complète :

| File | What it is |
| --- | --- |
| `shipvo.json` | Identifiant de l'application, nom, URL du control plane, clé publique épinglée dans le shell. Chaque commande `shipvo` le lit. |
| `app.json` | Configuration Expo avec le plugin `@shipvo/runtime` (la racine de confiance + le control plane vont dans le shell natif) et les chaînes de permissions Expo. |
| `App.tsx` | Un petit écran qui démarre le runtime OTA et utilise l'API device : scan, localisation, empreinte, notification. |
| `src/release.ts` | Le premier fichier que vous modifiez : poussez un changement et chaque téléphone et simulateur le reçoit. |
| `metro.config.js` | `withShipvoSim` : les builds simulateur remplacent les modules natifs d'Expo par le device simulé. |
| `.github/workflows/publish.yml` | Exécute `shipvo publish` pour vous à chaque push vers `main` (optionnel ; vous pouvez toujours l'exécuter vous-même). |
| `.shipvo/seed.txt` | Votre seed de signature de release Ed25519, ignorée par git. **Sauvegardez-la hors ligne.** Si vous la perdez, les shells installés n'accepteront plus jamais de mise à jour. Exécutez `shipvo keys export` et gardez une copie ([changer de machine](new-machine.md)). |

## 2. Run it in the simulator

```bash
npm run sim
```

Cela construit le bundle web avec le device simulé et le sert sur `http://localhost:4545`. Maintenant, laissez un agent l'utiliser. Dans Claude Desktop, Claude Code, Cursor ou PiPilot :

```json
{ "mcpServers": { "shipvo": { "command": "npx", "args": ["-y", "@shipvo/mcp"] } } }
```

Demandez à l'agent `open_app("myshop")`. Il reçoit le premier écran comme arbre d'accessibilité avec des refs et peut `tap`, `type`, `scroll`, `back`, `screenshot`. Touchez « Scan a code » et la boîte de dialogue de permission caméra Android apparaît dans l'arbre ; l'agent y répond comme une personne. `set_device` décide de ce que le téléphone possède :

```
set_device(session, camera: { barcode: { type: "qr", data: "HELLO-123" } }, location: { latitude: 4.05, longitude: 9.7 })
```

`device_log` liste chaque événement device, chacun marqué `simulated: true`. Rien ici n'est une vraie caméra, un vrai capteur d'empreinte ou un vrai paiement, et l'API ne prétend jamais le contraire : `device.capabilities()` renvoie `simulated` pour chaque capacité dans le simulateur et `real` sur téléphone.

Vous pouvez aussi piloter le simulateur depuis un terminal :

```bash
curl -s -X POST localhost:4545/session -H 'content-type: application/json' -d '{"session":"s1","app":"myshop"}'
curl -s -X POST localhost:4545/act -H 'content-type: application/json' -d '{"session":"s1","action":"tap","ref":"e11"}'
```

## 3. Use the device API in your own screens

```tsx
import { device } from "@shipvo/device";
import { ScanHost } from "@shipvo/device/scan";   // mount once at the root; device.camera.scan() then works on phones

const code = await device.camera.scan({ prompt: "Point at the barcode" });   // { type, data } or null
const here = await device.location.current();                               // asks permission first
const auth = await device.auth.confirm("Confirm payment of 4 200 FCFA");    // { ok: true } | { ok: false, reason }
const paid = await device.pay.charge({ provider: "mobile_money", amount: 4200, currency: "FCFA", to: "My Shop", reference: "MS-1", phone: "677000111" }, pin);
await device.notifications.show({ title: "Order confirmed", body: "MS-1 is being prepared", data: { order: "MS-1" } });
device.notifications.onOpen((n) => openOrder(n.data?.order));
```

La référence complète est dans [device-api.md](device-api.md). Les écrans construits dessus fonctionnent sans changement sur téléphone et dans le simulateur ; les dialogues système sont formulés comme Android ou iOS les formulent selon la plateforme du device simulé.

## 4. Put it on a phone

```bash
npx expo run:android          # or: npx eas build -p android
```

Le shell contient votre clé publique et l'URL du control plane comme méta-données du manifeste ; rien de livré over the air ne peut les modifier. Le bundle embarqué est la première release ; toutes les suivantes sont des téléchargements signés. Sur iOS, le même runtime vérifie et applique les releases publiées avec `shipvo publish --platform ios` (ou `all`) ; iOS télécharge pour l'instant des bundles complets, pas des patchs.

## 5. Publish over the air

**Hosted control plane (the default).** Connectez-vous une fois et enregistrez l'application :

```bash
npx -y @shipvo/cli login          # GitHub sign-in; saves your key
npx -y @shipvo/cli app create     # registers the app id + your public key, saves a publish token to .shipvo/publish-token
```

Pour la CI, ajoutez deux secrets du dépôt (Settings → Secrets → Actions) :

| Secret | Value |
| --- | --- |
| `SHIPVO_SIGNING_SEED` | le contenu de `.shipvo/seed.txt` |
| `SHIPVO_PUBLISH_TOKEN` | le contenu de `.shipvo/publish-token` (valide 90 jours ; exécutez `shipvo app create` à nouveau pour en générer un nouveau) |

Le publish token ne peut écrire que les propres fichiers de votre application, et chaque pointeur de release doit être vérifié par rapport à la clé publique que vous avez enregistrée, donc un token divulgué ne peut pas livrer du code à vos utilisateurs sans votre seed de signature. La seed ne quitte jamais votre machine ou la CI.

**Self-hosted control plane.** Au lieu du token, définissez `CLOUDFLARE_API_TOKEN` (Workers KV Storage: Edit), `CLOUDFLARE_ACCOUNT_ID` et `SHIPVO_KV_ID` (voir [self-hosting.md](self-hosting.md)) et pointez `controlPlane` dans `shipvo.json` vers votre Worker.

Puis modifiez `src/release.ts` et exécutez `shipvo publish`. (Dans un dépôt GitHub, le workflow fait la même chose à chaque push vers `main`.) Cela :

1. construit le bundle Hermes et le hache,
2. construit des patchs bsdiff depuis les releases récentes et depuis le bundle embarqué de chaque shell, pour que la plupart des mises à jour fassent quelques dizaines de kilo-octets,
3. construit l'artefact web du même commit pour le simulateur (`/w/<app>/r<N>/`),
4. signe le pointeur de release (Ed25519) et l'écrit pour chaque bande de cohorte (`b0` 1 %, `b1` 10 %, `b2` tout le monde).

Les téléphones vérifient quand ils sont ouverts, vérifient signature, hachage et taille, préparent de façon atomique, appliquent sans redémarrage et marquent la release comme saine une fois le premier écran rendu. Une release qui échoue à démarrer trois fois est abandonnée sur ce téléphone. `shipvo rollback --to 7` republie le code de la release 7 comme une nouvelle release pour tout le monde.

Les agents ouvrent la release exacte exécutée par les téléphones avec `open_app("myshop@r8")` ou `open_app("myshop@latest")`.

## 6. Give agents a key, not a laptop

Le simulateur fonctionne aussi en mode hébergé : un Worker lance un sandbox par clé API et expose les mêmes outils MCP via HTTPS, afin que ChatGPT ou tout agent distant puisse ouvrir une application avec une URL et sans rien installer. `npx -y @shipvo/cli login` vous connecte avec GitHub et vous donne une clé ; `shipvo mcp` affiche la configuration. Votre clé ouvre l'application d'exemple et chaque application que vous avez enregistrée avec `shipvo app create` : après une publication, `open_app("myshop@latest")` ouvre exactement la release exécutée par les téléphones. La bêta autorise 3 applications par compte et 500 MB chacune ; l'auto-hébergement est toujours ouvert. Voir [agents.md](agents.md).

## Where things are measured

Tout ce qui est affirmé ci-dessus vient de mesures sur du matériel réel, publiées dans ce dépôt : tailles et temps OTA sur un Redmi 9A 2 GB ([spike-results.md](spike-results.md)), et parité simulateur-appareil sur un émulateur Android et un simulateur iPhone, y compris ce que le score ne couvre pas ([parity-results.md](parity-results.md)).
