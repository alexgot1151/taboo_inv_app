# Inventory App

Simple bar inventory dashboard with login, bottle tracking, and shisha flavour counts.

## Run locally
1) Set password in `.env` (ignored by git):
```
APP_PASSWORD=makepussygreatagain
```
2) Start the API:
```
node inv_app/server.js
```
3) Open `inv_app/public/index.html` in a browser (or serve it with the docker-compose stack below).

## Docker
```
docker-compose up -d
```
- No host ports are published. The bundled nginx (service `inv_app`) internally proxies `/api` to `inv_app_api:4000` over the `scoobydoo` network. Attach Nginx Proxy Manager to the same network and forward external traffic to `inv_app:80`.

## Notes
- Default alcohols start at 700ml; every pour logs 40ml and warns at 150ml. “Add bottle” adds a full bottle (defaults to the item’s bottle size).
- Shisha flavours track pack grams and grams per bowl. “Serve 1” subtracts grams-per-bowl; “Restock pack” adds the pack size.
- Misc items track piece counts with quick +1 / -1 and remove.
- Inventory is persisted to `inv_app/data/inventory.json`.
- API binds to `0.0.0.0` so it can sit behind Nginx Proxy Manager.
