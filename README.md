# Fleetwise Fleet Maintenance PWA

An offline-first fleet maintenance Progressive Web App. The application shell is served as a PWA, and machine data is stored in IndexedDB through Dexie so local records do not depend on network access.

## Development

```powershell
npm install
npm run dev
```

Run the focused local data tests and production type/build checks:

```powershell
npm test
npm run build
```

## Current implementation stage

The foundation includes a responsive application shell, PWA manifest/service worker, local machine profiles and search, offline maintenance-record creation, an IndexedDB database, and a local outbox. Machine and maintenance writes are committed with their pending outbox operation in one IndexedDB transaction. English and Georgian interface localization is available from **Settings**; the selected language is stored separately from machine data on each device. Georgian-capable Noto Sans Georgian font files are bundled for offline use. Cross-device language preferences will be connected to employee profiles when authentication is implemented. Machine names, descriptions, and maintenance text are preserved verbatim.

Changes are explicitly described as saved on this device; synchronization is not implemented yet. Historical maintenance records are not imported, and maintenance schedules are not configured. Employees can add new maintenance records to a local machine profile while offline.

The Fleet page includes a read-only `.xlsx` dry run. It preserves populated-cell values, formulas/results, cell styles, comments, threaded-comment XML, worksheet layout, and worksheet/row/cell provenance in the review model; it reports candidate machines, history rows, schedule suggestions, and unresolved issues. Each flagged item can be inspected and annotated with an explicit human decision. Date interpretations and formula values are stored separately from the source; acknowledgements do not fill missing values, repair formulas, or remove duplicate rows. Review decisions are keyed to the source file's SHA-256 hash. No workbook contents are copied into the local database, and no records are imported. Workbook commits remain disabled. Files are limited to 20 MB and 500,000 populated cells.

The Excel source in `source-data/Maintenence.xlsx` is not modified. Import must start with a dry run and preserve source provenance; imported schedule recommendations require human confirmation.

## Platform notes

Installability and update prompts vary by browser. On iOS, use Safari's Share menu and **Add to Home Screen**. iOS and other browsers may restrict background synchronization and notifications. The app therefore needs to synchronize in the foreground when that phase is implemented. Browser storage can be cleared or evicted; persistent-storage requests and central backups are not substitutes for one another.

The production build generates a versioned cache-first service worker for the application shell and static assets. A production Chrome check confirmed the shell cache and local machine/maintenance records remained usable after two full browser-process restarts with the browser offline. This local-device check does not verify initial synchronization, installed-store behavior on iOS/Android, or server synchronization; those are not implemented.

This application must be served from HTTPS in production for service workers, installation, camera access, and secure authentication. Localhost is suitable for development.
