# Bulánci – hra

Hra v TypeScriptu: web (Vite + Canvas + WebAudio), iOS a Android (Capacitor). Levely, menu i historie běží
na původním bajtkódu skriptů z `bulanci.exe` ve virtuálním stroji (`src/core/vm/`), herní logika (bulánci,
zbraně, střely, bonusy, NPC) je přepsaná podle dekompilace originálu.

Umí: hru jednoho hráče proti počítači, 2–3 hráče u jedné klávesnice, 2–4 hráče po síti (přes [server](../server/README.md)),
všech 6 levelů a 6 zbraní, typy hry na čas, zásahy a životy, highscore, menu a historii s filmečky z originálu
a dotykové ovládání na mobilu.

## Rozběhání

Potřebuje Node.js 22.18+ a Python 3 (extraktor používá jen standardní knihovnu).

```sh
npm install
npm run assets   # bulanci.exe -> public/data
npm run dev      # http://localhost:5173
```

`npm run assets` stáhne původní hru z [bulanci.cz](https://www.bulanci.cz) (`bulanci_hra.zip`, freeware), pokud
`bulanci.exe` v této složce ještě není, a extraktorem `tools/extract.py` z něj vytáhne levely (bajtkód), obrázky
(PNG + metadata animací), zvuky, hudbu, filmečky a texty do `public/data/` (~9 s). Exe ani data se necommitují.

## Ovládání

- Menu: myš nebo dotyk; S / H / K = položky hlavního menu, Enter = Dále / Start, Esc = zpět.
- 1 hráč: šipky = pohyb, mezerník = střelba, C = přepnout zbraň, Esc = pauza, D = ladicí panel.
- Více hráčů u jedné klávesnice (pohyb / střelba / zbraň): E S D F / A / Q, I J K L / M / N
  a numerická klávesnice 8 4 5 6 / 0 / 1.
- Dotyk: arkádový panel s joystickem vlevo (při sepnutí směru cvakne, v nativní aplikaci a v Chromu na Androidu)
  a tlačítky Zbraň a Střelba vpravo. Na mobilu hraje vždy 1 hráč na zařízení, víc hráčů = síťová hra.
- `?round=<sekundy>` v URL zkrátí kolo (pro vývoj), např. `http://localhost:5173/?round=15`.

## Příkazy

```sh
npm run dev           # vývojový server
npm run build         # produkční build do dist/
npm test              # Vitest: VM, opcody, scéna, timery, animace, všech 6 levelů + determinismus, menu, síť
npm run e2e           # Playwright (Chromium, desktop + Pixel 7); poprvé: npx playwright install chromium
npm run test:extract  # regresní test extraktoru proti bulanci.exe
npm run cap:sync      # build + kopie do ios/ a android/
```

Testy i e2e potřebují vytažená data (`npm run assets`). E2E si samy spustí build a herní server.

## Nativní aplikace

`npm run cap:sync` po každé změně kódu nebo dat, pak:

- **iOS:** `npx cap open ios` a spustit z Xcode. Na reálném iPhonu je potřeba v Xcode vybrat podpisový tým
  (Signing & Capabilities). Simulátor z příkazové řádky:
  ```sh
  xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug \
    -derivedDataPath /tmp/bulanci-ios CODE_SIGNING_ALLOWED=NO build
  xcrun simctl install booted /tmp/bulanci-ios/Build/Products/Debug-iphonesimulator/App.app
  xcrun simctl launch booted cz.bulanci.game
  ```
- **Android:** JDK 21 a Android SDK (Android Studio, nebo `brew install --cask android-commandlinetools`
  + `sdkmanager "platform-tools" "platforms;android-36"`), cesta k SDK v `ANDROID_HOME` nebo
  v `android/local.properties`. Pak `cd android && ./gradlew assembleDebug`
  (APK v `app/build/outputs/apk/debug/`), případně `npx cap open android`.

## Struktura

- `src/core/` – čistá deterministická logika bez DOM: VM původního bajtkódu (`vm/`), scéna, timery, animace,
  config, highscore a parser stránek historie (`menu.ts`).
- `src/core/game/` – herní jádro: `Gaming`, `Bulanek`, zbraně, střely, miny, výbuchy, NPC.
- `src/net/` – síťová hra: protokol (sdílený se serverem), klient, lockstep.
- `src/platform/` – prohlížeč: načítání dat, Canvas render (800×600 s černými pruhy), HUD, text fontem originálu,
  widgety a obrazovky menu, dotykové ovládání a haptika, WebAudio, filmečky (AVI s MJPEG).
- `tools/` – extraktor dat z `bulanci.exe` (formáty jsou popsané v jeho docstringách) a jeho test.
- `test/`, `e2e/` – Vitest a Playwright.
- `ios/`, `android/` – nativní projekty Capacitoru.
