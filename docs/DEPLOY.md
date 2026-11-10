# Deploying FEMOS (synthetic demo)

There are two ways to run FEMOS. **Neither is for real patient data** (see [SECURITY.md](../SECURITY.md)).

## 1. Public static site: DigitalOcean App Platform (free static tier)

`npm run build:static` produces `public/`:
- the website at `/`
- the field app at `/app/`, which runs fully on the device
- the console at `/console/`

Both apps start in **standalone mode**, with a synthetic demo log and precomputed learning insights. Connectors, server-side agents and the LLM are off.

1. Push the repository to GitHub (public, Apache-2.0).
2. DigitalOcean → App Platform → Create App → GitHub → this repo. The spec is in [.do/app.yaml](../.do/app.yaml):
   - build command `npm ci && npm run build:static`
   - output directory `public`
3. Check the `*.ondigitalocean.app` URL. The footer must say "engineering prototype, synthetic data".
4. After registering the domain (`femos.org` recommended, with `femoshealth.com` redirecting), go to App → Settings → Domains and add the DNS records DigitalOcean gives you. TLS is provisioned automatically.

All paths are root-relative (`/core/…`), so serve the app at the domain root, not a sub-path.

## 2. Full server (sync, agents, connectors)

```bash
npm ci && npm run synth && npm run seed
HOST=0.0.0.0 PORT=8765 npm start
```

A small Droplet (1–2 GiB) is enough for a demo. Put it behind TLS (Caddy or nginx), add rate limiting, and use synthetic data only.

| Variable | Effect |
|---|---|
| `FEMOS_DEMO=0` | Start without the synthetic demo log |
| `FEMOS_FHIR_BASE` | Push FHIR bundles to this server, and run `$validate` on every resource |
| `DHIS2_BASE`, `DHIS2_USER`, `DHIS2_PASS`, `DHIS2_ORGUNIT` | Send monthly dataValueSets. These are DHIS2 dry runs unless `DHIS2_IMPORT=1` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_FOLLOWUP_REMINDER` | Send approved template messages (Meta Cloud API) |
| `RAPIDPRO_BASE`, `RAPIDPRO_TOKEN`, `RAPIDPRO_FLOW_UUID` | Start RapidPro flows |
| `FEMOS_LLM_BASE`, `FEMOS_LLM_MODEL`, `FEMOS_LLM_KEY` | Any OpenAI-compatible endpoint, for example Ollama at `http://localhost:11434/v1` |

Without these variables, every connector writes its exact payload to `data/outbox/` for inspection.
