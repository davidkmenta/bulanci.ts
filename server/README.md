# Bulánci – server

WebSocket server pro síťovou hru (až 4 hráči). Drží seznam her, lobby a chat a řídí lockstep: sbírá vstupy
hráčů, pečetí je do tiků a rozesílá všem, losuje seed kola a porovnává checksumy stavu, takže podvádění nebo
rozjetá hra se pozná. Herní logiku sám nepočítá, ta běží u hráčů. Protokol sdílí s hrou
(`../game/src/net/protocol.ts`).

## Spuštění

Potřebuje Node.js 22.18+ (spouští TypeScript přímo, bez buildu).

```sh
npm install
npm start        # ws://0.0.0.0:8787, port jde změnit proměnnou PORT
npm test         # testy hubu (node --test)
```

Hra se bez nastavení připojuje na `ws://<host, ze kterého se načetla stránka>:8787`. Jinou adresu jde zadat
ve hře v dialogu síťové hry, nebo ji zapéct do buildu: `VITE_NET_URL=wss://server.example npm run build`
(v `game/`).

## Docker

Image se staví z kořene repozitáře, protože potřebuje i `game/src/net/protocol.ts`:

```sh
docker build -f server/Dockerfile -t bulanci-server .
docker run -p 8787:8787 bulanci-server
```

## Soubory

- `index.ts` – WebSocket vrstva (`ws`), ping hráčů, takt hubu.
- `hub.ts` – logika místností a lockstepu, nezávislá na síti (testovaná v `hub.test.ts`).
