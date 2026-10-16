# Bulánci

Přepis české freewarové hry [Bulánci](https://www.bulanci.cz) (2006) do TypeScriptu. Původní zdrojové kódy se
ztratily, takže vše vzniklo zpětným inženýrstvím původního `bulanci.exe`: levely běží na původním bajtkódu
v přepsaném virtuálním stroji, grafika, zvuky a hudba se z exe extrahují. Hraje se v prohlížeči, na iOS
a na Androidu, sólo proti počítači, až 3 hráči u jedné klávesnice nebo až 4 hráči po síti.

| Složka | Obsah |
|---|---|
| [`game/`](game/README.md) | hra: web (Vite), iOS a Android (Capacitor), extraktor dat z `bulanci.exe` |
| [`server/`](server/README.md) | WebSocket server pro síťovou hru |

Rychlý start (Node.js 22.18+, Python 3):

```sh
cd game
npm install
npm run assets   # stáhne bulanci.exe z bulanci.cz a vytáhne z něj data
npm run dev      # http://localhost:5173
```

Původní hra, její grafika, zvuky a hudba patří autorům původní hry. Repozitář obsahuje jen nový kód,
herní data si každý vytáhne z oficiálně šířeného `bulanci.exe`.
