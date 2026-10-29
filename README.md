# BS Helper — study assistant for D2L Brightspace (Manifest V3 browser extension)

Een standalone browserextensie (TypeScript, React 18, Tailwind CSS, Shadow DOM) voor **D2L Brightspace** die alle beschikbare cursusinformatie van de ingelogde student verzamelt, documenten (`PDF`, `PPTX`, `DOCX`, `HTML`) direct in de browser parseert en vragen daarover beantwoordt met AI, via één `llm.generate(prompt, options)` interface. In productie gaan vragen via de eigen API-server in [`server/`](server/README.md); de ontwikkelbuild praat direct met Gemini met je eigen sleutel.

Niet gelieerd aan of goedgekeurd door D2L. Zie het [privacybeleid](PRIVACY.md).

---

## Backend en productie

De extensie praat in productie niet rechtstreeks met een AI, maar met de eigen API-server in [`server/`](server/README.md) (inloggen met e-mailcode, limieten, kostenboekhouding).

| Commando | Wat je krijgt |
|---|---|
| `npm run build:all` | Bouwt beide hieronder; laad `dist-online/` en `dist-dev/` als twee losse extensies (de dev-versie heet "(dev)") |
| `npm run build` | Uitvoer in `dist-online/`. **Zelfde als de online versie**: login met e-mailcode tegen `https://bshelper.duckdns.org`. Hiermee test je vanaf je laptop. |
| `npm run build:dev` | Uitvoer in `dist-dev/`. **Ontwikkelbuild, zonder login**: de extensie praat direct met Gemini via je eigen sleutel (Instellingen) en stelt vragen rechtstreeks aan de API (geen systeemprompt, geen filtering van het antwoord). Gebruik dit om aan de app zelf te werken |
| `npm run build:local` | Productie-opzet tegen je lokale server (`http://localhost:3000`): aanmelden met e-mailcode, inloggen met wachtwoord, limieten en accountbalk |
| `VITE_API_URL=https://jouw-host npm run build:prod` | Productiebuild voor de echte server |

Lokaal de loginversie proberen (zonder echte e-mail; de aanmeldcode verschijnt in de serverconsole):

```bash
cd server && npm install
PROVIDER=gemini PROVIDER_API_KEY=jouw-sleutel npm run dev   # of zonder die twee regels voor een nep-AI
cd .. && npm run build:local
```

---

## Nieuwe tools bouwen (relevantiefilter standaard aan)

Alle chat-achtige tools gebruiken `ChatShell` + `ChatComposer` (`src/components/chat/ChatShell.tsx`) voor een vaste indeling met de invoer onderaan. Cursuscontext geef je altijd als `contextBundle` aan de gateway; die past per vraag automatisch het relevantiefilter toe:

```ts
const bundle = buildContextBundle(courseData, selection, parsedDocs);
const res = await llm.generate(prompt, {
  contextBundle: bundle,
  relevance: { query: userQuestion },   // optioneel: { mode: 'all' } voor brede samenvattingen, 'off' alleen voor debuggen
});
res.contextStats; // { includedDocuments, totalDocuments, includedTokens, ... }
```

Per vraag kiest de gateway slim wat er meegaat (`src/services/context/retrieval.ts`): alleen de passende slides/pagina's met hun buren, alleen de secties waar de vraag over gaat, en een automatisch bredere tweede poging als het antwoord "niet gevonden" is terwijl er iets was weggelaten.

Eigen bestanden van de student (Context → My files, of als bijlage bij een vraag via de paperclip, slepen of plakken) komen als `user:`-documenten in dezelfde bundel. Bijlagen bij één vraag zijn `pinned` en worden nooit door het filter weggelaten.

In My files kun je ook een hele map toevoegen (knop "Add folder" of slepen, ook in het chatvenster). De mapstructuur blijft behouden (`metadata.userPath`, in de context als `My files > Map > Submap`), mappen zijn aan/uit te zetten en te verwijderen. Limieten: 300 bestanden, 400 MB per keer, 3000 items per map; verborgen/systeembestanden, `node_modules`, `.git` en niet-ondersteunde types worden overgeslagen en geteld in de samenvatting.

Zelf serialiseren (`serializeToMarkdown` e.d.) buiten `src/services` is niet toegestaan; een architectuurtest (`tests/architectural/llmBoundary.test.ts`) bewaakt dat, zodat nieuwe tools het filter niet per ongeluk omzeilen.

---

## Snelstart: Extensie inladen in Chrome / Brave / Edge

1. Bouw de extensie (uitvoer in `dist-online/`):
   ```bash
   npm install
   npm run build
   ```
2. Open in je browser `chrome://extensions` (of `brave://extensions` / `edge://extensions`).
3. Zet rechtsboven **Developer mode** (*Ontwikkelaarsmodus*) aan.
4. Klik linksboven op **Load unpacked** (*Uitgepakte extensie laden*) en selecteer de map:
   ```text
   dist-online/
   ```
5. Open een ingelogde Brightspace-pagina (bijv. `*.brightspace.com` of het Brightspace-domein van je universiteit met `/d2l/`). Rechtsonder verschijnt de **BS Helper** knop (of druk op `Alt+B`).

---

## Lokaal testen zonder live Brightspace (Mock Testomgeving)

Er zit een volledige gesimuleerde D2L Brightspace-cursusomgeving in [`test-page/mock-brightspace.html`](test-page/mock-brightspace.html) (inclusief gesimuleerde `/d2l/api/...` endpoints voor modules, announcements, opdrachten, quizzes, kalender en cijfers):

```bash
npx vite preview --port 4173
```
Open vervolgens `http://localhost:4173/test-page/mock-brightspace.html` in de browser waarin de extensie geladen is.

---

## Projectstructuur

- [`src/services/brightspace/`](src/services/brightspace) — Auto-detectie van Brightspace-URL's & `orgUnitId`, dynamische API-versie-detectie (`/d2l/api/versions/`), parallelle Valence REST collectors en IndexedDB caching (`storage.ts`).
- [`src/services/parsers/`](src/services/parsers) — In-browser documentparsers voor `.pdf` (`pdfjs-dist`), `.pptx` (`jszip` slides + speaker notes), `.docx` (`mammoth`) en `.html` (`turndown`).
- [`src/services/context/contextSerializer.ts`](src/services/context/contextSerializer.ts) — Zet geselecteerde cursusdata en geparseerde bestanden om naar bron-geannoteerde Markdown (`.md`) en JSON (`.json`).
- [`src/services/llm/`](src/services/llm) — De strikte single-gateway [`llmClient.ts`](src/services/llm/llmClient.ts) (`llm.generate(prompt, options)`) met [`geminiMode.ts`](src/services/llm/geminiMode.ts) en [`proxyMode.ts`](src/services/llm/proxyMode.ts).
- [`src/components/`](src/components) — Shadow DOM UI-componenten: `FloatingButton`, `HelperDrawer`, `HeaderSwitch`, `CourseSwitcher`, `ContextSelectorTree`, `Chat`, `SettingsModal` en de uitbreidbare `ActionRegistry`.

---

## Commando's

```bash
npm run typecheck   # TypeScript type-check (tsc --noEmit)
npm test            # Draai alle unit-, stress-, architectuur- en integratietests (Vitest)
npm run build       # Bouw productie Manifest V3 bundel in dist-online/
```
