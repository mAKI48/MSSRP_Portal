# ER:LC Taktisk Planerare

Inofficiellt operativt planeringssystem för Roblox Emergency Response: Liberty County RP-servrar.

**Inte kopplat till Roblox eller Emergency Response: Liberty County.**

## Funktioner

- Ladda upp ER:LC-karta (PNG/JPG/WEBP)
- Placera taktiska symboler (polis, insats, mål, positioner)
- Rita rutter, pilar, former och områden
- Text och anteckningar
- Insatsgrupper med filter
- Lager (visa/dölj/lås)
- Tidslinje
- Ångra / Gör om
- Zoom & pan
- **Lokal lagring med IndexedDB** – kartbild och hela planeringen sparas i webbläsaren
- Import / Export av `.erlcplan`-filer
- Exportera plan som PNG/JPG
- Demooperation: Operation Nightfall

## Användning (GitHub Pages)

1. Forka eller ladda upp denna mapp till ett GitHub-repository.
2. Gå till **Settings → Pages**.
3. Under **Source** välj **Deploy from a branch**.
4. Välj branch `main` (eller `master`) och mapp `/ (root)`.
5. Spara. Sidan publiceras på `https://<användare>.github.io/<repo>/`.

Eftersom projektet är rent HTML/CSS/JS behövs inget bygge.

## Lokal utveckling

Öppna `index.html` i en modern webbläsare, eller kör en enkel lokal server:

```bash
npx serve .
# eller
python -m http.server 8080
```

## Teknisk stack

- HTML5 + CSS3 + Vanilla JavaScript
- [Konva.js](https://konvajs.org/) – canvas för karta och objekt
- IndexedDB – lokal lagring av operationer och kartbilder
- Inga backend-krav, fungerar offline efter första laddning (CDN för Konva)

## Filstruktur

```
/
├── index.html
├── style.css
├── app.js
├── assets/
│   ├── icons/
│   └── ui/
├── README.md
└── .nojekyll
```

## Viktigt om lagring

All data sparas lokalt i webbläsarens IndexedDB.  
Om du rensar webbplatsdata försvinner operationerna.  
Använd **Exportera .erlcplan** för backup och för att flytta planer mellan datorer.

## Licens

Fritt att använda och modifiera för RP-ändamål.
