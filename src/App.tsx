import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudOff,
  HardHat,
  LayoutDashboard,
  Languages,
  MapPin,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Truck,
  Wrench,
  X
} from 'lucide-react';
import { db } from './data/localDb';
import { archiveMachine, saveMachine, searchMachines } from './data/machines';
import { saveMaintenanceRecord } from './data/maintenance';
import { i18n, restoreLocalePreference, saveLocalePreference, type AppLocale } from './i18n';
import type {
  Machine,
  MachineInput,
  MaintenanceRecordInput,
  MeterUnit,
  WorkbookIssueDecision,
  WorkbookIssueDecisionAction
} from './types';
import type { WorkbookDryRun, WorkbookIssue } from './data/workbookImport';
import { useTranslation } from 'react-i18next';

type Page = 'dashboard' | 'fleet' | 'settings';

const meterUnits: MeterUnit[] = ['hours', 'kilometers', 'miles', 'unknown'];
const maintenanceCategories = [
  'scheduled',
  'preventive',
  'corrective',
  'emergency',
  'inspection',
  'fluids',
  'component',
  'other'
] as const;

function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState<Page>('dashboard');
  const [selectedMachineId, setSelectedMachineId] = useState<string>();
  const [query, setQuery] = useState('');
  const [showMachineForm, setShowMachineForm] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine>();
  const [workbookPreview, setWorkbookPreview] = useState<WorkbookDryRun>();
  const [isAnalyzingWorkbook, setIsAnalyzingWorkbook] = useState(false);
  const [workbookReviewHash, setWorkbookReviewHash] = useState<string>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [networkAvailable, setNetworkAvailable] = useState(navigator.onLine);
  const [errorMessage, setErrorMessage] = useState('');

  const allMachines = useLiveQuery(() => searchMachines(''), [], []);
  const machines = useLiveQuery(() => searchMachines(query), [query], []);
  const pendingCount = useLiveQuery(
    () => db.outbox.where('status').equals('pending').count(),
    [],
    0
  );
  const selectedMachine = useLiveQuery(
    () => (selectedMachineId ? db.machines.get(selectedMachineId) : undefined),
    [selectedMachineId]
  );
  const workbookDecisions = useLiveQuery(
    () => workbookReviewHash
      ? db.workbookIssueDecisions.where('workbookHash').equals(workbookReviewHash).toArray()
      : [],
    [workbookReviewHash],
    []
  );

  const activeMachines = useMemo(
    () => allMachines.filter((machine) => machine.status === 'active'),
    [allMachines]
  );

  useEffect(() => {
    const updateNetworkState = () => setNetworkAvailable(navigator.onLine);
    window.addEventListener('online', updateNetworkState);
    window.addEventListener('offline', updateNetworkState);
    return () => {
      window.removeEventListener('online', updateNetworkState);
      window.removeEventListener('offline', updateNetworkState);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void restoreLocalePreference()
      .then(async (locale) => {
        if (active && i18n.resolvedLanguage !== locale) {
          await i18n.changeLanguage(locale);
        }
      })
      .catch((error: unknown) => {
        console.error('Could not restore the saved language preference.', error);
        if (active) setErrorMessage(t('errors.loadLanguage'));
      });

    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    const locale = i18n.resolvedLanguage === 'ka' ? 'ka' : 'en';
    document.documentElement.lang = locale;
    document.title = i18n.t('document.title', { lng: locale });
    document.querySelector('meta[name="description"]')?.setAttribute(
      'content',
      i18n.t('document.description', { lng: locale })
    );
  }, [i18n.resolvedLanguage]);

  function openFleet() {
    setPage('fleet');
    setSelectedMachineId(undefined);
    setMenuOpen(false);
  }

  function openDashboard() {
    setPage('dashboard');
    setSelectedMachineId(undefined);
    setMenuOpen(false);
  }

  function openSettings() {
    setPage('settings');
    setSelectedMachineId(undefined);
    setMenuOpen(false);
  }

  function startCreateMachine() {
    setEditingMachine(undefined);
    setShowMachineForm(true);
    setErrorMessage('');
  }

  async function handleSaveMachine(input: MachineInput): Promise<Machine> {
    const saved = await saveMachine(input);
    setShowMachineForm(false);
    setEditingMachine(undefined);
    setErrorMessage('');
    setPage('fleet');
    setSelectedMachineId(saved.id);
    return saved;
  }

  async function handleWorkbookSelected(file: File): Promise<void> {
    setIsAnalyzingWorkbook(true);
    setWorkbookPreview(undefined);
    setErrorMessage('');
    try {
      if (file.size > 20 * 1024 * 1024) {
        setErrorMessage(t('import.errors.file-too-large'));
        return;
      }
      const { analyzeWorkbook } = await import('./data/workbookImport');
      const preview = await analyzeWorkbook(file.name, await file.arrayBuffer());
      await db.workbookReviews.put({
        id: preview.sourceHash,
        fileName: file.name,
        analyzedAt: new Date().toISOString()
      });
      setWorkbookPreview(preview);
      setWorkbookReviewHash(preview.sourceHash);
    } catch (error) {
      console.error('The selected workbook could not be analyzed.', error);
      setErrorMessage(
        t(`import.errors.${getWorkbookImportErrorCode(error) ?? 'read-failed'}`)
      );
    } finally {
      setIsAnalyzingWorkbook(false);
    }
  }

  async function handleWorkbookDecision(
    issue: WorkbookIssue,
    action: WorkbookIssueDecisionAction,
    interpretedValue?: string
  ): Promise<void> {
    if (!workbookPreview || !issue.id) {
      throw new Error('The review item is missing its source identity.');
    }

    const decision: WorkbookIssueDecision = {
      id: `${workbookPreview.sourceHash}:${issue.id}`,
      workbookHash: workbookPreview.sourceHash,
      issueId: issue.id,
      action,
      interpretedValue,
      updatedAt: new Date().toISOString()
    };
    await db.workbookIssueDecisions.put(decision);
  }

  async function handleArchiveMachine(machine: Machine) {
    if (!window.confirm(t('profile.archiveConfirm', { name: machine.displayName }))) {
      return;
    }

    try {
      await archiveMachine(machine.id);
      setSelectedMachineId(undefined);
      setErrorMessage('');
    } catch (error) {
      console.error('Machine could not be archived on this device.', error);
      setErrorMessage(t('errors.archiveMachine'));
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <HardHat size={20} strokeWidth={2.2} />
          </div>
          <div>
            <div className="brand-name">{t('brand.title')}</div>
            <div className="brand-caption">{t('brand.tagline')}</div>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            aria-label={t('navigation.close')}
            onClick={() => setMenuOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <div className="workspace-label">{t('navigation.workspace')}</div>
        <nav className="primary-nav" aria-label={t('navigation.main')}>
          <button
            className={`nav-item ${page === 'dashboard' && !selectedMachineId ? 'nav-item-active' : ''}`}
            onClick={openDashboard}
            type="button"
          >
            <LayoutDashboard size={18} />
            <span>{t('navigation.dashboard')}</span>
          </button>
          <button
            className={`nav-item ${page === 'fleet' ? 'nav-item-active' : ''}`}
            onClick={openFleet}
            type="button"
          >
            <Truck size={18} />
            <span>{t('navigation.fleet')}</span>
            <span className="nav-count">{allMachines.length}</span>
          </button>
          <button
            className={`nav-item ${page === 'settings' ? 'nav-item-active' : ''}`}
            onClick={openSettings}
            type="button"
          >
            <Settings size={18} />
            <span>{t('navigation.settings')}</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="offline-card">
            <div className="offline-card-icon">
              <CloudOff size={17} />
            </div>
            <div>
              <strong>{t('navigation.offlineReady')}</strong>
              <span>{t('navigation.localData')}</span>
            </div>
          </div>
          <div className="profile-chip">
            <div className="avatar">{t('navigation.fleetManagerInitials')}</div>
            <div className="profile-copy">
              <strong>{t('navigation.fleetManager')}</strong>
              <span>{t('navigation.localWorkspace')}</span>
            </div>
            <button className="icon-button profile-settings" type="button" aria-label={t('navigation.settings')} onClick={openSettings}>
              <Settings size={17} />
            </button>
          </div>
        </div>
      </aside>

      {menuOpen && (
        <button
          className="mobile-backdrop"
          type="button"
          aria-label={t('navigation.close')}
          onClick={() => setMenuOpen(false)}
        />
      )}

      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            type="button"
            aria-label={t('navigation.open')}
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span>{t('header.fleetOperations')}</span>
            <ChevronRight size={14} />
            <strong>
              {selectedMachine
                ? selectedMachine.displayName
                : t(`navigation.${page === 'settings' ? 'settings' : page}`)}
            </strong>
          </div>
          <div className="topbar-actions">
            <div className={`connection-pill ${networkAvailable ? '' : 'connection-offline'}`}>
              <span className="connection-dot" />
              {networkAvailable ? t('header.networkAvailable') : t('header.offline')}
            </div>
            <button className="icon-button notification-button" type="button" aria-label={t('header.notifications')}>
              <Bell size={18} />
              <span className="notification-dot" />
            </button>
            <div className="topbar-avatar" aria-label={t('navigation.fleetManager')}>
              {t('navigation.fleetManagerInitials')}
            </div>
          </div>
        </header>

        <div className="page-content">
          {errorMessage && (
            <div className="error-banner" role="alert">
              <span>{errorMessage}</span>
              <button
                className="icon-button"
                type="button"
                aria-label={t('header.dismissError')}
                onClick={() => setErrorMessage('')}
              >
                <X size={17} />
              </button>
            </div>
          )}

          {selectedMachine ? (
            <MachineProfile
              machine={selectedMachine}
              onBack={openFleet}
              onEdit={() => {
                setEditingMachine(selectedMachine);
                setShowMachineForm(true);
              }}
              onArchive={() => void handleArchiveMachine(selectedMachine)}
            />
          ) : page === 'dashboard' ? (
            <Dashboard
              machines={allMachines}
              activeMachines={activeMachines.length}
              pendingCount={pendingCount}
              onOpenFleet={openFleet}
              onCreateMachine={startCreateMachine}
            />
          ) : page === 'fleet' ? (
            <FleetPage
              machines={machines}
              query={query}
              onQueryChange={setQuery}
              onCreateMachine={startCreateMachine}
              onOpenMachine={(machine) => setSelectedMachineId(machine.id)}
              workbookPreview={workbookPreview}
              workbookDecisions={workbookDecisions}
              onWorkbookDecision={handleWorkbookDecision}
              isAnalyzingWorkbook={isAnalyzingWorkbook}
              onWorkbookSelected={handleWorkbookSelected}
            />
          ) : (
            <SettingsPage />
          )}
        </div>

        <nav className="mobile-nav" aria-label={t('navigation.main')}>
          <button
            className={page === 'dashboard' && !selectedMachineId ? 'mobile-nav-active' : ''}
            type="button"
            onClick={openDashboard}
          >
            <LayoutDashboard size={19} />
            <span>{t('navigation.dashboard')}</span>
          </button>
          <button
            className={page === 'fleet' ? 'mobile-nav-active' : ''}
            type="button"
            onClick={openFleet}
          >
            <Truck size={19} />
            <span>{t('navigation.fleet')}</span>
          </button>
          <button type="button" onClick={startCreateMachine}>
            <Plus size={20} />
            <span>{t('dashboard.addMachine')}</span>
          </button>
          <button type="button" aria-label={t('header.notifications')}>
            <Bell size={19} />
            <span>{t('header.notifications')}</span>
          </button>
        </nav>
      </main>

      {showMachineForm && (
        <MachineForm
          machine={editingMachine}
          onClose={() => {
            setShowMachineForm(false);
            setEditingMachine(undefined);
          }}
          onSave={handleSaveMachine}
        />
      )}
    </div>
  );
}

function Dashboard({
  machines,
  activeMachines,
  pendingCount,
  onOpenFleet,
  onCreateMachine
}: {
  machines: Machine[];
  activeMachines: number;
  pendingCount: number;
  onOpenFleet: () => void;
  onCreateMachine: () => void;
}) {
  const { t, i18n } = useTranslation();
  const needsAttention = machines.filter((machine) => machine.status === 'inactive').length;
  const metrics = [
    { label: t('dashboard.totalMachines'), value: machines.length, icon: Truck, tone: 'slate' },
    { label: t('dashboard.activeFleet'), value: activeMachines, icon: Check, tone: 'green' },
    { label: t('dashboard.needsAttention'), value: needsAttention, icon: Bell, tone: 'amber' }
  ];

  return (
    <>
      <section className="welcome-row">
        <div>
          <div className="eyebrow">{formatDashboardDate(i18n.resolvedLanguage)}</div>
          <h1>{t('greeting.afternoon')}</h1>
          <p className="page-lede">{t('dashboard.lede')}</p>
        </div>
        <button className="button button-primary" type="button" onClick={onCreateMachine}>
          <Plus size={17} />
          {t('dashboard.addMachine')}
        </button>
      </section>

      <section className="metric-grid" aria-label={t('dashboard.fleetSummary')}>
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <article className="metric-card" key={label}>
            <div className={`metric-icon metric-icon-${tone}`}>
              <Icon size={19} />
            </div>
            <div className="metric-copy">
              <span>{label}</span>
              <strong>{new Intl.NumberFormat(i18n.resolvedLanguage).format(value)}</strong>
            </div>
            <div className="metric-trend">
              <ArrowUpRight size={15} />
            </div>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="panel fleet-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('dashboard.fleetOverview')}</h2>
              <p>{t('dashboard.localMachines')}</p>
            </div>
            <button className="text-button" type="button" onClick={onOpenFleet}>
              {t('dashboard.viewFleet')} <ChevronRight size={15} />
            </button>
          </div>

          {machines.length === 0 ? (
            <EmptyState
              icon={<Truck size={22} />}
              title={t('dashboard.startsHere')}
              description={t('dashboard.addOrImport')}
              action={
                <button className="button button-secondary" type="button" onClick={onCreateMachine}>
                  <Plus size={16} /> {t('dashboard.addFirstMachine')}
                </button>
              }
            />
          ) : (
            <div className="overview-list">
              {machines.slice(0, 5).map((machine) => (
                <div className="overview-row" key={machine.id}>
                  <div className="machine-thumbnail">
                    <Truck size={19} />
                  </div>
                  <div className="overview-machine">
                    <strong>{machine.displayName}</strong>
                    <span>{[machine.manufacturer, machine.model].filter(Boolean).join(' · ') || t('dashboard.detailsNotAdded')}</span>
                  </div>
                  <StatusBadge status={machine.status} />
                  <ChevronRight className="overview-chevron" size={16} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel attention-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('dashboard.maintenanceAttention')}</h2>
              <p>{t('dashboard.scheduleNotConfigured')}</p>
            </div>
            <div className="attention-symbol">
              <Wrench size={18} />
            </div>
          </div>
          <div className="attention-empty">
            <div className="attention-line">
              <span className="attention-line-icon">
                <Clock3 size={16} />
              </span>
              <div>
                <strong>{t('dashboard.noSchedule')}</strong>
                <span>{t('dashboard.scheduleReview')}</span>
              </div>
            </div>
            <div className="attention-line">
              <span className="attention-line-icon attention-line-muted">
                <ShieldCheck size={16} />
              </span>
              <div>
                <strong>{t('dashboard.localSaved')}</strong>
                <span>
                  {pendingCount === 0
                    ? t('dashboard.noPendingChanges')
                    : t(pendingCount === 1 ? 'dashboard.pendingOne' : 'dashboard.pendingMany', {
                        count: new Intl.NumberFormat(i18n.resolvedLanguage).format(pendingCount)
                      })}
                </span>
              </div>
            </div>
          </div>
          <div className="panel-footnote">
            <CircleHelp size={15} /> {t('dashboard.noIntervals')}
          </div>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('dashboard.recentMaintenance')}</h2>
              <p>{t('dashboard.latestWork')}</p>
            </div>
            <button className="text-button muted-button" type="button" disabled>
              {t('dashboard.allRecords')} <ChevronRight size={15} />
            </button>
          </div>
          <EmptyState
            icon={<Wrench size={20} />}
            title={t('dashboard.noHistory')}
            description={t('dashboard.importHistory')}
          />
        </div>
        <div className="panel update-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('dashboard.operatingHours')}</h2>
              <p>{t('dashboard.latestMeters')}</p>
            </div>
            <div className="update-icon">
              <ArrowDownRight size={17} />
            </div>
          </div>
          <div className="meter-empty">
            <span>—</span>
            <p>{t('dashboard.noVerifiedMeters')}</p>
          </div>
          <div className="panel-footnote">
            <MapPin size={14} /> {t('dashboard.meterUnitNote')}
          </div>
        </div>
      </section>

      <footer className="page-footer">
        <span>{t('brand.title')} · {t('navigation.localWorkspace')}</span>
        <span>
          {t(pendingCount === 1 ? 'dashboard.pendingLocalOne' : 'dashboard.pendingLocalMany', {
            count: new Intl.NumberFormat(i18n.resolvedLanguage).format(pendingCount)
          })}
        </span>
      </footer>
    </>
  );
}

function FleetPage({
  machines,
  query,
  onQueryChange,
  onCreateMachine,
  onOpenMachine,
  workbookPreview,
  workbookDecisions,
  onWorkbookDecision,
  isAnalyzingWorkbook,
  onWorkbookSelected
}: {
  machines: Machine[];
  query: string;
  onQueryChange: (value: string) => void;
  onCreateMachine: () => void;
  onOpenMachine: (machine: Machine) => void;
  workbookPreview?: WorkbookDryRun;
  workbookDecisions: WorkbookIssueDecision[];
  onWorkbookDecision: (
    issue: WorkbookIssue,
    action: WorkbookIssueDecisionAction,
    interpretedValue?: string
  ) => Promise<void>;
  isAnalyzingWorkbook: boolean;
  onWorkbookSelected: (file: File) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();

  return (
    <>
      <section className="welcome-row fleet-welcome">
        <div>
          <div className="eyebrow">{t('fleet.directory')}</div>
          <h1>{t('fleet.title')}</h1>
          <p className="page-lede">{t('fleet.searchDescription')}</p>
        </div>
        <button className="button button-primary" type="button" onClick={onCreateMachine}>
          <Plus size={17} />
          {t('dashboard.addMachine')}
        </button>
      </section>

      <WorkbookImportPanel
        preview={workbookPreview}
        decisions={workbookDecisions}
        onDecision={onWorkbookDecision}
        isAnalyzing={isAnalyzingWorkbook}
        onFileSelected={onWorkbookSelected}
      />

      <section className="fleet-toolbar">
        <label className="search-field">
          <Search size={18} />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('fleet.searchPlaceholder')}
            aria-label={t('fleet.searchLabel')}
          />
          {query && (
            <button
              type="button"
              aria-label={t('fleet.clearSearch')}
              className="search-clear"
              onClick={() => onQueryChange('')}
            >
              <X size={15} />
            </button>
          )}
        </label>
        <span className="result-count">
          {t(machines.length === 1 ? 'fleet.machineOne' : 'fleet.machineMany', {
            count: new Intl.NumberFormat(i18n.resolvedLanguage).format(machines.length)
          })}
        </span>
      </section>

      {machines.length === 0 ? (
        <div className="panel fleet-empty-panel">
          <EmptyState
            icon={query ? <Search size={22} /> : <Truck size={22} />}
            title={t(query ? 'fleet.noMatches' : 'fleet.noneOnDevice')}
            description={
              query
                ? t('fleet.tryAnotherSearch')
                : t('fleet.addOrImport')
            }
            action={
              query ? undefined : (
                <button className="button button-secondary" type="button" onClick={onCreateMachine}>
                  <Plus size={16} /> {t('dashboard.addMachine')}
                </button>
              )
            }
          />
        </div>
      ) : (
        <section className="machine-grid" aria-label={t('fleet.machineList')}>
          {machines.map((machine) => (
            <button
              className="machine-card"
              type="button"
              key={machine.id}
              onClick={() => onOpenMachine(machine)}
            >
              <div className="machine-card-top">
                <div className="machine-thumbnail machine-thumbnail-large">
                  <Truck size={22} />
                </div>
                <StatusBadge status={machine.status} />
              </div>
              <div className="machine-card-copy">
                <strong>{machine.displayName}</strong>
                <span>{[machine.manufacturer, machine.model].filter(Boolean).join(' · ') || t('profile.manufacturerModelMissing')}</span>
              </div>
              <div className="machine-card-meta">
                <span>{machine.registrationNumber || machine.serialNumber || t('fleet.noRegistration')}</span>
                <span>
                  {machine.meterValue !== undefined
                    ? `${new Intl.NumberFormat(i18n.resolvedLanguage).format(machine.meterValue)} ${meterUnitLabel(machine.meterUnit, t)}`
                    : t('fleet.meterNotRecorded')}
                </span>
              </div>
              <div className="machine-card-footer">
                <span>{machine.location || t('fleet.locationNotSet')}</span>
                <ChevronRight size={17} />
              </div>
            </button>
          ))}
        </section>
      )}

      <footer className="page-footer">
        <span>{t('fleet.localSearch')}</span>
        <span>{t('fleet.notSynced')}</span>
      </footer>
    </>
  );
}

function WorkbookImportPanel({
  preview,
  decisions,
  onDecision,
  isAnalyzing,
  onFileSelected
}: {
  preview?: WorkbookDryRun;
  decisions: WorkbookIssueDecision[];
  onDecision: (
    issue: WorkbookIssue,
    action: WorkbookIssueDecisionAction,
    interpretedValue?: string
  ) => Promise<void>;
  isAnalyzing: boolean;
  onFileSelected: (file: File) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);

  function sourceValue(row: WorkbookDryRun['maintenanceRows'][number], label: string): string {
    return row.cells.find((cell) => cell.header.toLocaleLowerCase() === label.toLocaleLowerCase())
      ?.source.displayText ?? '';
  }

  return (
    <section className="panel workbook-import-panel" aria-labelledby="workbook-import-title">
      <div className="panel-heading">
        <div>
          <h2 id="workbook-import-title">{t('import.title')}</h2>
          <p>{t('import.description')}</p>
        </div>
        <div className="import-file-actions">
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label={t('import.chooseFile')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void onFileSelected(file);
            }}
          />
          <button
            className="button button-secondary"
            type="button"
            disabled={isAnalyzing}
            onClick={() => fileInput.current?.click()}
          >
            {isAnalyzing ? t('import.analyzing') : t('import.chooseFile')}
          </button>
        </div>
      </div>

      <div className="import-safety-note">
        <ShieldCheck size={16} />
        <span>{t('import.dryRunOnly')}</span>
      </div>

      {!preview ? (
        <p className="import-empty-note">{t('import.noWorkbook')}</p>
      ) : (
        <div className="import-report">
          <div className="import-file-name">{preview.fileName}</div>
          <div className="import-summary-grid">
            <ImportMetric label={t('import.worksheets')} value={preview.sheets.length} locale={i18n.resolvedLanguage} />
            <ImportMetric label={t('import.machineCandidates')} value={preview.machines.length} locale={i18n.resolvedLanguage} />
            <ImportMetric label={t('import.maintenanceCandidates')} value={preview.maintenanceRows.length} locale={i18n.resolvedLanguage} />
            <ImportMetric label={t('import.scheduleDrafts')} value={preview.schedules.length} locale={i18n.resolvedLanguage} />
            <ImportMetric label={t('import.unresolvedIssues')} value={preview.issues.length} locale={i18n.resolvedLanguage} />
          </div>
          <div className="import-preservation-note">
            {t('import.preservedSummary', {
              cells: new Intl.NumberFormat(i18n.resolvedLanguage).format(preview.sourceCellCount),
              formulas: new Intl.NumberFormat(i18n.resolvedLanguage).format(
                preview.sheets.reduce((count, sheet) =>
                  count + sheet.cells.filter((cell) => cell.formulaPresent).length, 0)
              ),
              comments: new Intl.NumberFormat(i18n.resolvedLanguage).format(preview.commentCount),
              threadedComments: new Intl.NumberFormat(i18n.resolvedLanguage).format(
                preview.threadedCommentCount
              ),
              formulaErrors: new Intl.NumberFormat(i18n.resolvedLanguage).format(preview.formulaErrorCount)
            })}
          </div>

          <div className="import-report-section">
            <h3>{t('import.sheetReview')}</h3>
            <div className="import-sheet-list">
              {preview.sheets.map((sheet) => (
                <div className="import-sheet-row" key={sheet.name}>
                  <strong>{sheet.name}</strong>
                  <span>{t(`import.sheetType.${sheet.kind}`)}</span>
                  <span>{t('import.sheetDimensions', {
                    rows: new Intl.NumberFormat(i18n.resolvedLanguage).format(sheet.rowCount),
                    columns: new Intl.NumberFormat(i18n.resolvedLanguage).format(sheet.columnCount)
                  })}</span>
                </div>
              ))}
            </div>
          </div>

          {preview.maintenanceRows.length > 0 && (
            <div className="import-report-section">
              <h3>{t('import.historySample')}</h3>
              <div className="import-table-scroll">
                <table className="import-preview-table">
                  <thead>
                    <tr>
                      <th>{t('import.sourceSheet')}</th>
                      <th>{t('import.sourceRow')}</th>
                      <th>{t('import.date')}</th>
                      <th>{t('import.descriptionField')}</th>
                      <th>{t('import.reading')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.maintenanceRows.slice(0, 5).map((row) => (
                      <tr key={`${row.sheetName}-${row.rowNumber}`}>
                        <td>{row.sheetName}</td>
                        <td>{row.rowNumber}</td>
                        <td>{sourceValue(row, 'Date')}</td>
                        <td>{sourceValue(row, 'Description')}</td>
                        <td>{sourceValue(row, 'Odometer')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.issues.length > 0 && (
            <div className="import-report-section">
              <h3>{t('import.unresolvedIssues')}</h3>
              <p className="import-review-progress">
                {t('import.reviewProgress', {
                  reviewed: decisions.length,
                  total: preview.issues.length
                })}
              </p>
              <div className="import-issue-list">
                {preview.issues.map((issue, index) => (
                  <WorkbookIssueReview
                    key={issue.id ?? `${issue.code}-${issue.sheetName}-${issue.rowNumber ?? index}`}
                    issue={issue}
                    preview={preview}
                    decision={decisions.find((item) => item.issueId === issue.id)}
                    onDecision={onDecision}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function WorkbookIssueReview({
  issue,
  preview,
  decision,
  onDecision
}: {
  issue: WorkbookIssue;
  preview: WorkbookDryRun;
  decision?: WorkbookIssueDecision;
  onDecision: (
    issue: WorkbookIssue,
    action: WorkbookIssueDecisionAction,
    interpretedValue?: string
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [interpretedValue, setInterpretedValue] = useState(decision?.interpretedValue ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const sourceRow = issue.rowNumber === undefined
    ? undefined
    : preview.maintenanceRows.find(
        (row) => row.sheetName === issue.sheetName && row.rowNumber === issue.rowNumber
      );
  const sheet = preview.sheets.find((candidate) => candidate.name === issue.sheetName);
  const rowNumber = issue.rowNumber ?? Number(issue.cellAddress?.match(/\d+$/)?.[0]);
  const sourceCells = sourceRow?.cells ?? (sheet?.cells.filter(
    (cell) => Number(cell.address.match(/\d+$/)?.[0]) === rowNumber
  ).map((source) => ({
    header: source.address,
    source
  })) ?? []);
  const needsDate = issue.code === 'history-date-needs-review' ||
    issue.code === 'history-date-missing';
  const isFormulaError = issue.code === 'formula-error';
  const isDuplicate = issue.code === 'duplicate-maintenance-record';

  async function saveDecision(
    action: WorkbookIssueDecisionAction,
    value?: string
  ): Promise<void> {
    setSaving(true);
    setSaveError(false);
    try {
      await onDecision(issue, action, value);
    } catch (error) {
      console.error('Workbook review decision could not be saved.', error);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={`import-issue-card ${decision ? 'import-issue-reviewed' : ''}`}>
      <div className="import-issue-title">
        <strong>{t(`import.issue.${issue.code}`, {
          sheet: issue.sheetName,
          row: issue.rowNumber,
          cell: issue.cellAddress,
          details: issue.details
        })}</strong>
        <span>{decision ? t('import.reviewed') : t('import.needsReview')}</span>
      </div>
      {sourceCells.length > 0 && (
        <details className="import-source-details">
          <summary>{t('import.inspectSource')}</summary>
          <dl>
            {sourceCells.map(({ header, source }) => (
              <div key={source.address}>
                <dt>{header} · {source.address}</dt>
                <dd>{source.displayText || t('import.emptySourceCell')}</dd>
                {source.formula && <dd>{t('import.formulaLabel')}: {source.formula}</dd>}
                {source.resultJson && <dd>{t('import.formulaResult')}: {source.resultJson}</dd>}
                {source.numberFormat && <dd>{t('import.numberFormat')}: {source.numberFormat}</dd>}
              </div>
            ))}
          </dl>
        </details>
      )}
      {!decision && needsDate && (
        <div className="import-review-action">
          <label>
            {t(issue.code === 'history-date-missing' ? 'import.enterMissingDate' : 'import.interpretDate')}
            <input
              type="date"
              value={interpretedValue}
              onChange={(event) => setInterpretedValue(event.target.value)}
            />
          </label>
          <button
            className="button button-secondary"
            type="button"
            disabled={saving || !interpretedValue}
            onClick={() => void saveDecision('interpreted-date', interpretedValue)}
          >
            {t('import.saveInterpretation')}
          </button>
          {issue.code === 'history-date-missing' && (
            <button
              className="text-button"
              type="button"
              disabled={saving}
              onClick={() => void saveDecision('acknowledged-missing-date')}
            >
              {t('import.leaveDateMissing')}
            </button>
          )}
        </div>
      )}
      {!decision && isFormulaError && (
        <div className="import-review-action">
          <label>
            {t('import.enterFormulaInterpretation')}
            <input
              type="text"
              value={interpretedValue}
              onChange={(event) => setInterpretedValue(event.target.value)}
            />
          </label>
          <button
            className="button button-secondary"
            type="button"
            disabled={saving || !interpretedValue.trim()}
            onClick={() => void saveDecision('interpreted-formula', interpretedValue.trim())}
          >
            {t('import.saveInterpretation')}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={saving}
            onClick={() => void saveDecision('acknowledged-source-error')}
          >
            {t('import.keepFormulaError')}
          </button>
        </div>
      )}
      {!decision && isDuplicate && (
        <div className="import-review-action">
          <button
            className="button button-secondary"
            type="button"
            disabled={saving}
            onClick={() => void saveDecision('distinct-records')}
          >
            {t('import.confirmDistinct')}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={saving}
            onClick={() => void saveDecision('confirmed-duplicate')}
          >
            {t('import.confirmDuplicate')}
          </button>
        </div>
      )}
      {decision && (
        <p className="import-decision-summary">
          {t(`import.decision.${decision.action}`, {
            value: decision.interpretedValue
          })}
        </p>
      )}
      {saveError && <p className="import-review-error" role="alert">{t('import.saveDecisionFailed')}</p>}
    </article>
  );
}

function ImportMetric({ label, value, locale }: { label: string; value: number; locale?: string }) {
  return (
    <div className="import-metric">
      <span>{label}</span>
      <strong>{new Intl.NumberFormat(locale).format(value)}</strong>
    </div>
  );
}

function MachineProfile({
  machine,
  onBack,
  onEdit,
  onArchive
}: {
  machine: Machine;
  onBack: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [showMaintenanceForm, setShowMaintenanceForm] = useState(false);
  const maintenanceRecords = useLiveQuery(
    () => db.maintenanceRecords.where('machineId').equals(machine.id).sortBy('performedAt'),
    [machine.id],
    []
  );

  return (
    <>
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={17} /> {t('profile.backToFleet')}
      </button>
      <section className="profile-heading">
        <div className="profile-machine-mark">
          <Truck size={25} />
        </div>
        <div className="profile-title">
          <div className="eyebrow">{t('profile.eyebrow')}</div>
          <h1>{machine.displayName}</h1>
          <p>
            {[machine.manufacturer, machine.model].filter(Boolean).join(' · ') || t('profile.manufacturerModelMissing')}
          </p>
        </div>
        <div className="profile-actions">
          <StatusBadge status={machine.status} />
          <button className="button button-secondary" type="button" onClick={onEdit}>
            {t('profile.editDetails')}
          </button>
          {machine.status !== 'archived' && (
            <button className="icon-button archive-button" type="button" onClick={onArchive} aria-label={t('profile.archiveMachine')}>
              <Archive size={17} />
            </button>
          )}
        </div>
      </section>

      <section className="profile-grid">
        <div className="panel profile-details">
          <div className="panel-heading">
            <div>
              <h2>{t('profile.machineDetails')}</h2>
              <p>{t('profile.localInfo')}</p>
            </div>
          </div>
          <div className="details-grid">
            <Detail label={t('profile.manufacturer')} value={machine.manufacturer} missing={t('profile.notRecorded')} />
            <Detail label={t('profile.model')} value={machine.model} missing={t('profile.notRecorded')} />
            <Detail label={t('profile.year')} value={machine.yearManufactured?.toString()} missing={t('profile.notRecorded')} />
            <Detail label={t('profile.category')} value={machine.category} missing={t('profile.notRecorded')} />
            <Detail label={t('profile.registration')} value={machine.registrationNumber} missing={t('profile.notRecorded')} />
            <Detail label={t('profile.serial')} value={machine.serialNumber} missing={t('profile.notRecorded')} />
            <Detail label={t('profile.location')} value={machine.location} missing={t('profile.notRecorded')} />
            <Detail label={t('profile.fuel')} value={machine.fuelType} missing={t('profile.notRecorded')} />
            <Detail label={t('profile.tankCapacity')} value={machine.tankCapacity} missing={t('profile.notRecorded')} />
            <Detail
              label={t('profile.currentMeter')}
              value={
                machine.meterValue !== undefined
                  ? `${new Intl.NumberFormat(i18n.resolvedLanguage).format(machine.meterValue)} ${meterUnitLabel(machine.meterUnit, t)}`
                  : undefined
              }
              missing={t('profile.notRecorded')}
            />
          </div>
          {machine.notes && <div className="notes-block"><span>{t('profile.notes')}</span><p>{machine.notes}</p></div>}
        </div>

        <div className="panel profile-timeline">
          <div className="panel-heading">
            <div>
              <h2>{t('profile.history')}</h2>
              <p>{t('profile.timeline')}</p>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setShowMaintenanceForm((visible) => !visible)}
            >
              <Plus size={15} /> {t('profile.addMaintenanceRecord')}
            </button>
          </div>
          {showMaintenanceForm && (
            <MaintenanceRecordForm
              machine={machine}
              onSaved={() => setShowMaintenanceForm(false)}
              onCancel={() => setShowMaintenanceForm(false)}
            />
          )}
          {maintenanceRecords.length === 0 && !showMaintenanceForm ? (
            <EmptyState
              icon={<Wrench size={20} />}
              title={t('profile.historyNotLoaded')}
              description={t('profile.importHistory')}
            />
          ) : (
            <ol className="maintenance-timeline">
              {[...maintenanceRecords].reverse().map((record) => (
                <li key={record.id}>
                  <div className="maintenance-timeline-dot" />
                  <div className="maintenance-record-content">
                    <div className="maintenance-record-heading">
                      <strong>{record.workPerformed}</strong>
                      <time dateTime={record.performedAt}>
                        {new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' })
                          .format(new Date(`${record.performedAt}T00:00:00`))}
                      </time>
                    </div>
                    <span>{t(`maintenance.category.${record.category}`, { defaultValue: record.category })}</span>
                    {record.meterReading !== undefined && (
                      <span>
                        {new Intl.NumberFormat(i18n.resolvedLanguage).format(record.meterReading)} {meterUnitLabel(machine.meterUnit, t)}
                      </span>
                    )}
                    {record.partsUsed && <p>{t('maintenance.partsUsed')}: {record.partsUsed}</p>}
                    {record.notes && <p>{record.notes}</p>}
                    <small>{t('maintenance.savedOnDevice')}</small>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="panel-footnote">
            <ShieldCheck size={15} /> {t('profile.historyPreserved')}
          </div>
        </div>

        <div className="panel profile-schedule">
          <div className="panel-heading">
            <div>
              <h2>{t('profile.schedule')}</h2>
              <p>{t('profile.upcoming')}</p>
            </div>
          </div>
          <div className="schedule-empty">
            <Clock3 size={19} />
            <div>
              <strong>{t('profile.noConfirmedSchedule')}</strong>
              <span>{t('profile.scheduleReview')}</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function MaintenanceRecordForm({
  machine,
  onSaved,
  onCancel
}: {
  machine: Machine;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [performedAt, setPerformedAt] = useState(() => {
    const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 10);
  });
  const [meterReading, setMeterReading] = useState('');
  const [category, setCategory] = useState<(typeof maintenanceCategories)[number]>('other');
  const [workPerformed, setWorkPerformed] = useState('');
  const [partsUsed, setPartsUsed] = useState('');
  const [notes, setNotes] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedReading = meterReading.trim() ? Number(meterReading) : undefined;
    if (meterReading.trim() && (parsedReading === undefined || !Number.isFinite(parsedReading) || parsedReading < 0)) {
      setSaveError(t('errors.invalidMeter'));
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const input: MaintenanceRecordInput = {
        machineId: machine.id,
        performedAt,
        meterReading: parsedReading,
        category,
        workPerformed,
        partsUsed: optionalValue(partsUsed),
        notes: optionalValue(notes)
      };
      await saveMaintenanceRecord(input);
      onSaved();
    } catch (error) {
      console.error('Maintenance record could not be saved on this device.', error);
      setSaveError(
        error instanceof Error && error.message.startsWith('errors.')
          ? t(error.message)
          : t('errors.saveMaintenance')
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="maintenance-record-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="form-grid">
        <Field label={t('maintenance.date')} required>
          <input type="date" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} required />
        </Field>
        <Field label={t('maintenance.categoryLabel')} required>
          <select value={category} onChange={(event) => setCategory(event.target.value as (typeof maintenanceCategories)[number])}>
            {maintenanceCategories.map((item) => (
              <option key={item} value={item}>{t(`maintenance.category.${item}`)}</option>
            ))}
          </select>
        </Field>
        <Field label={t('maintenance.meterReading')}>
          <input type="number" min="0" step="any" inputMode="decimal" value={meterReading} onChange={(event) => setMeterReading(event.target.value)} />
        </Field>
        <Field label={t('maintenance.workPerformed')} required wide>
          <textarea value={workPerformed} onChange={(event) => setWorkPerformed(event.target.value)} required rows={3} />
        </Field>
        <Field label={t('maintenance.partsUsed')} wide>
          <textarea value={partsUsed} onChange={(event) => setPartsUsed(event.target.value)} rows={2} />
        </Field>
        <Field label={t('maintenance.notes')} wide>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
        </Field>
      </div>
      {saveError && <p className="maintenance-record-error" role="alert">{saveError}</p>}
      <div className="form-actions">
        <button className="button button-secondary" type="button" onClick={onCancel} disabled={saving}>{t('form.cancel')}</button>
        <button className="button button-primary" type="submit" disabled={saving}>{t(saving ? 'maintenance.saving' : 'maintenance.save')}</button>
      </div>
    </form>
  );
}

function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);
  const [messageKey, setMessageKey] = useState('');
  const locale: AppLocale = i18n.resolvedLanguage === 'ka' ? 'ka' : 'en';

  async function handleLocaleChange(value: string) {
    if (value !== 'en' && value !== 'ka') {
      console.error('Unsupported language selection.', value);
      setMessageKey('settings.saveFailed');
      return;
    }

    setIsSaving(true);
    setMessageKey('');
    try {
      await saveLocalePreference(value);
      setMessageKey('settings.savedLocally');
    } catch (error) {
      console.error('Could not save the selected language preference.', error);
      setMessageKey('settings.saveFailed');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <section className="welcome-row">
        <div>
          <div className="eyebrow">{t('settings.eyebrow')}</div>
          <h1>{t('settings.title')}</h1>
          <p className="page-lede">{t('settings.description')}</p>
        </div>
      </section>

      <section className="settings-grid">
        <div className="panel settings-card">
          <div className="panel-heading">
            <div>
              <h2>{t('settings.language')}</h2>
              <p>{t('settings.languageDescription')}</p>
            </div>
            <Languages size={19} aria-hidden="true" />
          </div>
          <div className="settings-field">
            <label htmlFor="settings-language">{t('settings.language')}</label>
            <select
              id="settings-language"
              value={locale}
              disabled={isSaving}
              onChange={(event) => void handleLocaleChange(event.target.value)}
            >
              <option value="en">{t('settings.english')}</option>
              <option value="ka">{t('settings.georgian')}</option>
            </select>
            <p>{t('settings.crossDevice')}</p>
            {isSaving && <span role="status">{t('settings.saving')}</span>}
            {!isSaving && messageKey && (
              <span role={messageKey === 'settings.saveFailed' ? 'alert' : 'status'}>
                {t(messageKey)}
              </span>
            )}
          </div>
        </div>

        <div className="panel settings-card">
          <div className="panel-heading">
            <div>
              <h2>{t('settings.installTitle')}</h2>
              <p>{t('settings.installDescription')}</p>
            </div>
          </div>
          <p className="settings-install-note">{t('settings.installDesktop')}</p>
        </div>
      </section>
    </>
  );
}

function MachineForm({
  machine,
  onClose,
  onSave
}: {
  machine?: Machine;
  onClose: () => void;
  onSave: (input: MachineInput) => Promise<Machine>;
}) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(machine?.displayName ?? '');
  const [manufacturer, setManufacturer] = useState(machine?.manufacturer ?? '');
  const [model, setModel] = useState(machine?.model ?? '');
  const [registrationNumber, setRegistrationNumber] = useState(machine?.registrationNumber ?? '');
  const [serialNumber, setSerialNumber] = useState(machine?.serialNumber ?? '');
  const [yearManufactured, setYearManufactured] = useState(machine?.yearManufactured?.toString() ?? '');
  const [category, setCategory] = useState(machine?.category ?? '');
  const [location, setLocation] = useState(machine?.location ?? '');
  const [fuelType, setFuelType] = useState(machine?.fuelType ?? '');
  const [tankCapacity, setTankCapacity] = useState(machine?.tankCapacity ?? '');
  const [meterUnit, setMeterUnit] = useState<MeterUnit>(machine?.meterUnit ?? 'unknown');
  const [meterValue, setMeterValue] = useState(machine?.meterValue?.toString() ?? '');
  const [notes, setNotes] = useState(machine?.notes ?? '');
  const [status, setStatus] = useState<Machine['status']>(machine?.status ?? 'active');
  const [validationError, setValidationError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedYear = yearManufactured.trim() ? Number(yearManufactured) : undefined;
    const parsedMeter = meterValue.trim() ? Number(meterValue) : undefined;

    if (yearManufactured.trim() && !Number.isInteger(parsedYear)) {
      setValidationError(t('errors.invalidYear'));
      return;
    }
    if (meterValue.trim() && !Number.isFinite(parsedMeter)) {
      setValidationError(t('errors.invalidMeter'));
      return;
    }

    setValidationError('');
    setSaveError('');
    setIsSaving(true);
    try {
      await onSave({
        id: machine?.id,
        displayName,
        manufacturer: optionalValue(manufacturer),
        model: optionalValue(model),
        registrationNumber: optionalValue(registrationNumber),
        serialNumber: optionalValue(serialNumber),
        yearManufactured: parsedYear,
        category: optionalValue(category),
        location: optionalValue(location),
        fuelType: optionalValue(fuelType),
        tankCapacity: optionalValue(tankCapacity),
        meterUnit,
        meterValue: parsedMeter,
        meterRecordedAt: parsedMeter === undefined ? machine?.meterRecordedAt : new Date().toISOString(),
        notes: optionalValue(notes),
        status,
        sourceAttributes: machine?.sourceAttributes ?? {}
      });
    } catch (error) {
      console.error('Machine could not be saved on this device.', error);
      setSaveError(
        error instanceof Error && error.message.startsWith('errors.')
          ? t(error.message)
          : t('errors.saveMachine')
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="machine-modal" role="dialog" aria-modal="true" aria-labelledby="machine-form-title">
        <div className="modal-heading">
          <div>
            <div className="eyebrow">{t(machine ? 'form.updateEyebrow' : 'form.newEyebrow')}</div>
            <h2 id="machine-form-title">{t(machine ? 'form.editTitle' : 'form.addTitle')}</h2>
            <p>{t('form.savedLocally')}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t('form.close')}>
            <X size={19} />
          </button>
        </div>
        <form className="machine-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label={t('form.machineName')} required>
              <input autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </Field>
            <Field label={t('form.category')}>
              <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder={t('form.categoryExample')} />
            </Field>
            <Field label={t('form.manufacturer')}>
              <input value={manufacturer} onChange={(event) => setManufacturer(event.target.value)} />
            </Field>
            <Field label={t('form.model')}>
              <input value={model} onChange={(event) => setModel(event.target.value)} />
            </Field>
            <Field label={t('form.registration')}>
              <input value={registrationNumber} onChange={(event) => setRegistrationNumber(event.target.value)} />
            </Field>
            <Field label={t('form.serial')}>
              <input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} />
            </Field>
            <Field label={t('form.year')}>
              <input
                inputMode="numeric"
                value={yearManufactured}
                onChange={(event) => setYearManufactured(event.target.value)}
              />
            </Field>
            <Field label={t('form.location')}>
              <input value={location} onChange={(event) => setLocation(event.target.value)} />
            </Field>
            <Field label={t('form.meterType')}>
              <select value={meterUnit} onChange={(event) => setMeterUnit(event.target.value as MeterUnit)}>
                {meterUnits.map((unit) => (
                  <option key={unit} value={unit}>{t(`meter.${unit}`)}</option>
                ))}
              </select>
            </Field>
            <Field label={t('form.currentMeter')}>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={meterValue}
                onChange={(event) => setMeterValue(event.target.value)}
              />
            </Field>
            <Field label={t('form.fuelType')}>
              <input value={fuelType} onChange={(event) => setFuelType(event.target.value)} />
            </Field>
            <Field label={t('form.tankCapacity')}>
              <input value={tankCapacity} onChange={(event) => setTankCapacity(event.target.value)} placeholder={t('form.keepUnits')} />
            </Field>
            <Field label={t('form.status')}>
              <select value={status} onChange={(event) => setStatus(event.target.value as Machine['status'])}>
                <option value="active">{t('status.active')}</option>
                <option value="inactive">{t('status.inactive')}</option>
                {machine?.status === 'archived' && <option value="archived">{t('status.archived')}</option>}
              </select>
            </Field>
            <div className="field field-wide">
              <label htmlFor="machine-notes">{t('form.notes')}</label>
              <textarea id="machine-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
          </div>

          {(validationError || saveError) && (
            <p className="form-error" role="alert">{validationError || saveError}</p>
          )}

          <div className="modal-actions">
            <button className="button button-secondary" type="button" onClick={onClose}>{t('form.cancel')}</button>
            <button className="button button-primary" type="submit" disabled={isSaving}>
              <Check size={17} /> {isSaving ? t('form.saving') : t('form.saveOnDevice')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({
  label,
  required = false,
  wide = false,
  children
}: {
  label: string;
  required?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''}`}>
      <span className="field-label">
        {label}
        {required && <span className="required-mark"> *</span>}
      </span>
      {children}
    </label>
  );
}

function Detail({ label, value, missing }: { label: string; value?: string; missing: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value || missing}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: Machine['status'] }) {
  const { t } = useTranslation();
  return <span className={`status-badge status-${status}`}>{t(`status.${status}`)}</span>;
}

function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

function meterUnitLabel(
  unit: MeterUnit,
  t: ReturnType<typeof useTranslation>['t']
): string {
  switch (unit) {
    case 'hours':
      return t('unit.hours');
    case 'kilometers':
      return t('unit.kilometers');
    case 'miles':
      return t('unit.miles');
    case 'unknown':
      return '';
  }
}

function optionalValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function getWorkbookImportErrorCode(
  error: unknown
): 'file-too-large' | 'too-many-cells' | 'invalid-workbook' | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined;
  const { code } = error;
  if (code === 'file-too-large' || code === 'too-many-cells' || code === 'invalid-workbook') {
    return code;
  }
  return undefined;
}

function formatDashboardDate(locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale === 'ka' ? 'ka-GE' : 'en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(new Date()).toUpperCase();
}

export default App;
