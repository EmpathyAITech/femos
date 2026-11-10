# Security and data policy

## Never put real patient data here

This repository, its issue tracker, the demo server and the public website are for **synthetic data only**. Do not paste or attach any of the following, even if you think they are anonymised:
- real names, phone numbers or ABHA numbers
- photos, audio or lab reports

## Reporting a vulnerability

Email ankita@empathyaitech.com with the steps to reproduce. Do not open a public issue. We aim to acknowledge reports within 3 working days.

## Production hardening checklist

| Area | Public demo | Production deployment |
|---|---|---|
| Authentication | Demo role picker, no login | Real identity, role-based access, device enrolment |
| Event authenticity | The server accepts events from any client | Signed events and per-user keys, with the server checking the actor against the session |
| Storage | IndexedDB and a JSON-lines file, unencrypted | Encryption at rest on device and server, key management, retention policy |
| Transport | HTTP on localhost | TLS everywhere, certificate pinning in a native app |
| Hosting | Laptop or static site | Government- or partner-approved hosting in India, a privacy impact assessment, data processing agreements |
| Minors | Guardian consent and assent captured as events | Legal review of DPDP Act 2023 verifiable parental consent, plus ethics approval |
| Messaging | Approved templates, neutral wording, dry-run | Meta business verification, opt-out handling, a review of shared-phone risk |
| Regulation | For clinician review only | Assessment under India's Medical Device Rules (CDSCO) for any individual-level decision support |
