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

Changes are explicitly described as saved on this device; synchronization is not implemented yet. Maintenance schedules are not configured. Employees can add new maintenance records to a local machine profile while offline.

**Import from Excel** on the Fleet page reads an `.xlsx` workbook without changing it. The read-only analysis preserves populated-cell values, formulas/results, cell styles, comments, threaded-comment XML, worksheet layout, and worksheet/row/cell provenance; the import panel shows only what will be saved (machines, service records, and entries without a date). Dates entered for undated entries are stored separately from the source and keyed to the workbook's SHA-256 hash. Files are limited to 20 MB and 500,000 populated cells.

**Import data** saves machine profiles and history rows in one IndexedDB transaction, each with a pending outbox operation and its workbook sheet/row provenance in `sourceAttributes`:

- Each equipment sheet becomes a machine named after the sheet; its category comes from the **Home** index sheet. The current meter is the **Ending Mileage** value, and the meter unit is set only when the sheet's own readings consistently say `h` or `km`.
- Rows identical to the **TEMPLATE** sheet's example rows are not imported, and template example values left in real rows (for example, costs of 25/10) are ignored.
- Dates are read day-first, as written throughout the workbook. Text such as `29/10/2025` or `12.11.2025` is parsed day-first, and stored Excel dates whose day and month are both 12 or less are swapped back, because a month-first Excel locale converted entries such as `10/07/2025` into 7 October. The original cell value is kept with each record.
- Rows without a usable date are not imported and no date is invented. The import panel lists them so a known date can be added before importing.
- Excel threaded comments on a machine sheet's component rows (part numbers for oil, air, fuel and hydraulic filters, batteries, tires) become that machine's **Parts & specifications** list, labelled by the commented row. Empty comments and replies are not imported. Re-importing adds part details to machines that were imported before they existed, without changing anything else. Part numbers are searchable on the Fleet page.
- The dashboard's **Upcoming service** list and each machine's schedule card show the workbook's "Next service" target and how far the current meter (or the latest history reading) is from it.
- Importing again is safe: rows already imported and machines that already exist on the device (matched by sheet, registration, or serial number) are left unchanged.

The Excel source in `source-data/Maintenence.xlsx` is not modified. Import must start with a dry run and preserve source provenance; schedule recommendations from the workbook are not imported and require human confirmation.

## Platform notes

Installability and update prompts vary by browser. On iOS, use Safari's Share menu and **Add to Home Screen**. iOS and other browsers may restrict background synchronization and notifications. The app therefore needs to synchronize in the foreground when that phase is implemented. Browser storage can be cleared or evicted; persistent-storage requests and central backups are not substitutes for one another.

The production build generates a versioned cache-first service worker for the application shell and static assets. A production Chrome check confirmed the shell cache and local machine/maintenance records remained usable after two full browser-process restarts with the browser offline. This local-device check does not verify initial synchronization, installed-store behavior on iOS/Android, or server synchronization; those are not implemented.

This application must be served from HTTPS in production for service workers, installation, camera access, and secure authentication. Localhost is suitable for development.
