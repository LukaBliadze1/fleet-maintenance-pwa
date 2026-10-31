import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CloudOff,
  FileSpreadsheet,
  Gauge,
  HardHat,
  Layers,
  LayoutDashboard,
  Languages,
  Menu,
  Plus,
  Search,
  Settings,
  Truck,
  Wrench,
  X
} from 'lucide-react';
import { db } from './data/localDb';
import { archiveMachine, saveMachine, searchMachines } from './data/machines';
import { saveMaintenanceRecord } from './data/maintenance';
import { nextService, type NextService } from './data/service';
import { i18n, restoreLocalePreference, saveLocalePreference, type AppLocale } from './i18n';
import type {
  Machine,
  MachineInput,
  MaintenanceRecordInput,
  MeterUnit,
  WorkbookIssueDecision
} from './types';
import type { WorkbookDryRun } from './data/workbookImport';
import type { SkippedRow, WorkbookCommitResult, WorkbookImportPlan } from './data/workbookCommit';
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
  const [workbookPlan, setWorkbookPlan] = useState<WorkbookImportPlan>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [networkAvailable, setNetworkAvailable] = useState(navigator.onLine);
  const [errorMessage, setErrorMessage] = useState('');

  const allMachines = useLiveQuery(() => searchMachines(''), [], []);
  const machines = useLiveQuery(() => searchMachines(query), [query], []);
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
    if (!workbookPreview) {
      setWorkbookPlan(undefined);
      return;
    }

    let active = true;
    void import('./data/workbookCommit')
      .then(({ planWorkbookImport }) => planWorkbookImport(workbookPreview, workbookDecisions))
      .then((plan) => {
        if (active) setWorkbookPlan(plan);
      })
      .catch((error: unknown) => {
        console.error('The workbook import could not be prepared.', error);
        if (active) setErrorMessage(t('import.planFailed'));
      });

    return () => {
      active = false;
    };
  }, [workbookPreview, workbookDecisions, t]);

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

  async function handleAddWorkbookDate(issueId: string, date: string): Promise<void> {
    if (!workbookPreview) {
      throw new Error('No workbook is being imported.');
    }

    const decision: WorkbookIssueDecision = {
      id: `${workbookPreview.sourceHash}:${issueId}`,
      workbookHash: workbookPreview.sourceHash,
      issueId,
      action: 'interpreted-date',
      interpretedValue: date,
      updatedAt: new Date().toISOString()
    };
    await db.workbookIssueDecisions.put(decision);
  }

  function closeWorkbookImport() {
    setWorkbookPreview(undefined);
    setWorkbookReviewHash(undefined);
  }

  async function handleWorkbookCommit(): Promise<WorkbookCommitResult> {
    if (!workbookPlan) {
      throw new Error('The workbook import is not ready.');
    }

    const { commitWorkbookImport } = await import('./data/workbookCommit');
    return commitWorkbookImport(workbookPlan);
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
              onOpenFleet={openFleet}
              onOpenMachine={(machine) => setSelectedMachineId(machine.id)}
              onCreateMachine={startCreateMachine}
            />
          ) : page === 'fleet' ? (
            <FleetPage
              allMachines={allMachines}
              machines={machines}
              query={query}
              onQueryChange={setQuery}
              onCreateMachine={startCreateMachine}
              onOpenMachine={(machine) => setSelectedMachineId(machine.id)}
              workbookPreview={workbookPreview}
              workbookPlan={workbookPlan}
              onAddWorkbookDate={handleAddWorkbookDate}
              onWorkbookCommit={handleWorkbookCommit}
              onCloseWorkbookImport={closeWorkbookImport}
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
          <button
            className={page === 'settings' ? 'mobile-nav-active' : ''}
            type="button"
            onClick={openSettings}
          >
            <Settings size={19} />
            <span>{t('navigation.settings')}</span>
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
  onOpenFleet,
  onOpenMachine,
  onCreateMachine
}: {
  machines: Machine[];
  activeMachines: number;
  onOpenFleet: () => void;
  onOpenMachine: (machine: Machine) => void;
  onCreateMachine: () => void;
}) {
  const { t, i18n } = useTranslation();
  const records = useLiveQuery(
    () => db.maintenanceRecords.orderBy('performedAt').reverse().toArray(),
    [],
    []
  );
  const machinesById = new Map(machines.map((machine) => [machine.id, machine]));
  const latestReadings = new Map<string, number>();
  for (const record of records) {
    if (record.meterReading !== undefined && !latestReadings.has(record.machineId)) {
      latestReadings.set(record.machineId, record.meterReading);
    }
  }
  const serviceRank = (service: NextService) => service.remaining ?? Number.MAX_SAFE_INTEGER;
  const upcomingService = machines
    .flatMap((machine) => {
      const service = nextService(machine, latestReadings.get(machine.id));
      return service ? [{ machine, service }] : [];
    })
    .sort((left, right) => serviceRank(left.service) - serviceRank(right.service))
    .slice(0, 5);
  const categoryCounts = [...machines.reduce((counts, machine) => {
    const category = machine.category ?? t('dashboard.uncategorized');
    return counts.set(category, (counts.get(category) ?? 0) + 1);
  }, new Map<string, number>())].sort((left, right) => right[1] - left[1]);
  const needsAttention = machines.filter((machine) => machine.status === 'inactive').length;
  const formatNumber = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
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
          <h1>{t(greetingKey())}</h1>
          <p className="page-lede">{t('dashboard.lede')}</p>
        </div>
        <button className="button button-primary" type="button" onClick={onCreateMachine}>
          <Plus size={17} />
          {t('dashboard.addMachine')}
        </button>
      </section>

      <section className="metric-grid" aria-label={t('dashboard.fleetSummary')}>
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <button className="metric-card" type="button" key={label} onClick={onOpenFleet}>
            <div className={`metric-icon metric-icon-${tone}`}>
              <Icon size={19} />
            </div>
            <div className="metric-copy">
              <span>{label}</span>
              <strong>{formatNumber(value)}</strong>
            </div>
            <div className="metric-trend">
              <ArrowUpRight size={15} />
            </div>
          </button>
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
                <button
                  className="overview-row overview-row-button"
                  type="button"
                  key={machine.id}
                  onClick={() => onOpenMachine(machine)}
                >
                  <div className="machine-thumbnail">
                    <Truck size={19} />
                  </div>
                  <div className="overview-machine">
                    <strong>{machine.displayName}</strong>
                    <span>{machineSubtitle(machine)}</span>
                  </div>
                  <StatusBadge status={machine.status} />
                  <ChevronRight className="overview-chevron" size={16} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel attention-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('dashboard.upcomingService')}</h2>
              <p>{t('dashboard.upcomingServiceHint')}</p>
            </div>
            <div className="attention-symbol">
              <Gauge size={18} />
            </div>
          </div>
          {upcomingService.length === 0 ? (
            <EmptyState
              icon={<Clock3 size={20} />}
              title={t('dashboard.noUpcomingService')}
              description={t('dashboard.noUpcomingServiceHint')}
            />
          ) : (
            <div className="overview-list">
              {upcomingService.map(({ machine, service }) => (
                <button
                  className="overview-row overview-row-button"
                  type="button"
                  key={machine.id}
                  onClick={() => onOpenMachine(machine)}
                >
                  <div className="overview-machine">
                    <strong>{machine.displayName}</strong>
                    <span>
                      {t('dashboard.serviceAt', {
                        value: formatMeter(service.target, service.unit, i18n.resolvedLanguage, t)
                      })}
                    </span>
                  </div>
                  <ServiceRemaining service={service} />
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('dashboard.recentMaintenance')}</h2>
              <p>{t('dashboard.latestWork')}</p>
            </div>
          </div>
          {records.length === 0 ? (
            <EmptyState
              icon={<Wrench size={20} />}
              title={t('dashboard.noHistory')}
              description={t('dashboard.importHistory')}
            />
          ) : (
            <div className="overview-list">
              {records.slice(0, 5).map((record) => {
                const machine = machinesById.get(record.machineId);
                return (
                  <button
                    className="overview-row overview-row-button"
                    type="button"
                    key={record.id}
                    disabled={!machine}
                    onClick={() => machine && onOpenMachine(machine)}
                  >
                    <div className="machine-thumbnail">
                      <Wrench size={17} />
                    </div>
                    <div className="overview-machine">
                      <strong>{record.workPerformed}</strong>
                      <span>
                        {[machine?.displayName, formatRecordDate(record.performedAt, i18n.resolvedLanguage)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="panel update-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('dashboard.byCategory')}</h2>
              <p>{t('dashboard.byCategoryHint')}</p>
            </div>
            <div className="update-icon">
              <Layers size={17} />
            </div>
          </div>
          {categoryCounts.length === 0 ? (
            <EmptyState
              icon={<Layers size={20} />}
              title={t('fleet.noneOnDevice')}
              description={t('dashboard.addOrImport')}
            />
          ) : (
            <div className="category-list">
              {categoryCounts.map(([category, count]) => (
                <div className="category-row" key={category}>
                  <div className="category-row-label">
                    <span>{category}</span>
                    <strong>{formatNumber(count)}</strong>
                  </div>
                  <div className="category-bar" aria-hidden="true">
                    <span style={{ width: `${(count / machines.length) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function ServiceRemaining({ service }: { service: NextService }) {
  const { t, i18n } = useTranslation();
  if (service.remaining === undefined) return null;

  const value = formatMeter(Math.abs(service.remaining), service.unit, i18n.resolvedLanguage, t);
  return (
    <span className={`service-remaining ${service.remaining < 0 ? 'service-overdue' : ''}`}>
      {t(service.remaining < 0 ? 'dashboard.serviceOverdue' : 'dashboard.serviceRemaining', { value })}
    </span>
  );
}

function FleetPage({
  allMachines,
  machines,
  query,
  onQueryChange,
  onCreateMachine,
  onOpenMachine,
  workbookPreview,
  workbookPlan,
  onAddWorkbookDate,
  onWorkbookCommit,
  onCloseWorkbookImport,
  isAnalyzingWorkbook,
  onWorkbookSelected
}: {
  allMachines: Machine[];
  machines: Machine[];
  query: string;
  onQueryChange: (value: string) => void;
  onCreateMachine: () => void;
  onOpenMachine: (machine: Machine) => void;
  workbookPreview?: WorkbookDryRun;
  workbookPlan?: WorkbookImportPlan;
  onAddWorkbookDate: (issueId: string, date: string) => Promise<void>;
  onWorkbookCommit: () => Promise<WorkbookCommitResult>;
  onCloseWorkbookImport: () => void;
  isAnalyzingWorkbook: boolean;
  onWorkbookSelected: (file: File) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [importOpen, setImportOpen] = useState(false);
  const [category, setCategory] = useState<string>();
  const showImport = importOpen || isAnalyzingWorkbook || Boolean(workbookPreview) || allMachines.length === 0;
  const categoryCounts = [...allMachines.reduce((counts, machine) => (
    machine.category ? counts.set(machine.category, (counts.get(machine.category) ?? 0) + 1) : counts
  ), new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right));
  const visibleMachines = category
    ? machines.filter((machine) => machine.category === category)
    : machines;
  const formatNumber = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
  const isFiltered = Boolean(query || category);

  return (
    <>
      <section className="welcome-row fleet-welcome">
        <div>
          <div className="eyebrow">{t('fleet.directory')}</div>
          <h1>{t('fleet.title')}</h1>
          <p className="page-lede">{t('fleet.searchDescription')}</p>
        </div>
        <div className="welcome-actions">
          {!showImport && (
            <button className="button button-secondary" type="button" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet size={17} />
              {t('fleet.importExcel')}
            </button>
          )}
          <button className="button button-primary" type="button" onClick={onCreateMachine}>
            <Plus size={17} />
            {t('dashboard.addMachine')}
          </button>
        </div>
      </section>

      {showImport && (
        <WorkbookImportPanel
          preview={workbookPreview}
          plan={workbookPlan}
          isAnalyzing={isAnalyzingWorkbook}
          onFileSelected={onWorkbookSelected}
          onAddDate={onAddWorkbookDate}
          onCommit={onWorkbookCommit}
          onClose={() => {
            setImportOpen(false);
            onCloseWorkbookImport();
          }}
        />
      )}

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
          {t(visibleMachines.length === 1 ? 'fleet.machineOne' : 'fleet.machineMany', {
            count: formatNumber(visibleMachines.length)
          })}
        </span>
      </section>

      {categoryCounts.length > 1 && (
        <div className="category-chips" role="group" aria-label={t('fleet.categoryFilter')}>
          <button
            className={`chip ${category === undefined ? 'chip-active' : ''}`}
            type="button"
            aria-pressed={category === undefined}
            onClick={() => setCategory(undefined)}
          >
            {t('fleet.allCategories')} <span>{formatNumber(allMachines.length)}</span>
          </button>
          {categoryCounts.map(([name, count]) => (
            <button
              className={`chip ${category === name ? 'chip-active' : ''}`}
              type="button"
              key={name}
              aria-pressed={category === name}
              onClick={() => setCategory(category === name ? undefined : name)}
            >
              {name} <span>{formatNumber(count)}</span>
            </button>
          ))}
        </div>
      )}

      {visibleMachines.length === 0 ? (
        <div className="panel fleet-empty-panel">
          <EmptyState
            icon={isFiltered ? <Search size={22} /> : <Truck size={22} />}
            title={t(isFiltered ? 'fleet.noMatches' : 'fleet.noneOnDevice')}
            description={isFiltered ? t('fleet.tryAnotherSearch') : t('fleet.addOrImport')}
            action={
              isFiltered ? undefined : (
                <button className="button button-secondary" type="button" onClick={onCreateMachine}>
                  <Plus size={16} /> {t('dashboard.addMachine')}
                </button>
              )
            }
          />
        </div>
      ) : (
        <section className="machine-grid" aria-label={t('fleet.machineList')}>
          {visibleMachines.map((machine) => {
            const identifier = machine.registrationNumber || machine.serialNumber;
            const meter = machine.meterValue === undefined
              ? undefined
              : formatMeter(machine.meterValue, machine.meterUnit, i18n.resolvedLanguage, t);
            return (
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
                  <span>{[machine.manufacturer, machine.model].filter(Boolean).join(' · ')}</span>
                </div>
                {(identifier || meter) && (
                  <div className="machine-card-meta">
                    <span>{identifier}</span>
                    {meter && <span className="machine-card-meter"><Gauge size={13} /> {meter}</span>}
                  </div>
                )}
                <div className="machine-card-footer">
                  <span>{[machine.category, machine.location].filter(Boolean).join(' · ')}</span>
                  <ChevronRight size={17} />
                </div>
              </button>
            );
          })}
        </section>
      )}
    </>
  );
}

function WorkbookImportPanel({
  preview,
  plan,
  isAnalyzing,
  onFileSelected,
  onAddDate,
  onCommit,
  onClose
}: {
  preview?: WorkbookDryRun;
  plan?: WorkbookImportPlan;
  isAnalyzing: boolean;
  onFileSelected: (file: File) => Promise<void>;
  onAddDate: (issueId: string, date: string) => Promise<void>;
  onCommit: () => Promise<WorkbookCommitResult>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const readyPlan = plan && plan.sourceHash === preview?.sourceHash ? plan : undefined;

  return (
    <section className="panel workbook-import-panel" aria-labelledby="workbook-import-title">
      <div className="panel-heading">
        <div className="import-heading">
          <div className="import-heading-icon">
            <FileSpreadsheet size={19} />
          </div>
          <div>
            <h2 id="workbook-import-title">{t('import.title')}</h2>
            <p>{preview ? preview.fileName : t('import.description')}</p>
          </div>
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
            className={`button ${preview ? 'button-secondary' : 'button-primary'}`}
            type="button"
            disabled={isAnalyzing}
            onClick={() => fileInput.current?.click()}
          >
            {isAnalyzing ? t('import.analyzing') : t(preview ? 'import.chooseAnother' : 'import.chooseFile')}
          </button>
          <button className="icon-button" type="button" aria-label={t('import.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      {readyPlan && (
        <WorkbookImportReport
          key={readyPlan.sourceHash}
          plan={readyPlan}
          onAddDate={onAddDate}
          onCommit={onCommit}
          onDone={onClose}
        />
      )}
    </section>
  );
}

function WorkbookImportReport({
  plan,
  onAddDate,
  onCommit,
  onDone
}: {
  plan: WorkbookImportPlan;
  onAddDate: (issueId: string, date: string) => Promise<void>;
  onCommit: () => Promise<WorkbookCommitResult>;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<WorkbookCommitResult>();
  const [commitError, setCommitError] = useState(false);
  const formatCount = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
  const undatedRows = plan.skippedRows.filter((row) => row.reason === 'date-unresolved' && row.issueId);
  const leftOutCount = plan.skippedRows.length - undatedRows.length;
  const partCount = plan.machines.reduce((count, { input }) => count + (input.parts?.length ?? 0), 0);

  useEffect(() => setResult(undefined), [plan]);

  async function handleCommit(): Promise<void> {
    setCommitting(true);
    setCommitError(false);
    try {
      setResult(await onCommit());
    } catch (error) {
      console.error('The workbook import could not be saved on this device.', error);
      setCommitError(true);
    } finally {
      setCommitting(false);
    }
  }

  if (result) {
    return (
      <div className="import-body">
        <div className="import-success" role="status">
          <CheckCircle2 size={22} />
          <div>
            <strong>{t('import.successTitle')}</strong>
            <span>
              {result.machinesCreated + result.machinesUpdated + result.recordsCreated > 0
                ? t('import.successDetail', {
                    machines: formatCount(result.machinesCreated),
                    updated: formatCount(result.machinesUpdated),
                    records: formatCount(result.recordsCreated)
                  })
                : t('import.nothingNew')}
            </span>
          </div>
          <button className="button button-primary" type="button" onClick={onDone}>
            {t('import.done')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="import-body">
      <div className="import-summary-grid">
        <ImportMetric label={t('import.machines')} value={plan.machines.length} locale={i18n.resolvedLanguage} />
        <ImportMetric label={t('import.records')} value={plan.records.length} locale={i18n.resolvedLanguage} />
        <ImportMetric label={t('import.parts')} value={partCount} locale={i18n.resolvedLanguage} />
        <ImportMetric label={t('import.withoutDate')} value={undatedRows.length} locale={i18n.resolvedLanguage} />
      </div>

      {undatedRows.length > 0 && (
        <div className="import-undated">
          <h3>{t('import.undatedTitle')}</h3>
          <p>{t('import.undatedHint')}</p>
          <ul className="import-undated-list">
            {undatedRows.map((row) => (
              <UndatedEntryForm key={`${row.sheetName}-${row.rowNumber}`} row={row} onAddDate={onAddDate} />
            ))}
          </ul>
        </div>
      )}

      <div className="import-footer">
        <p className="import-note">
          {leftOutCount > 0 && t('import.leftOut', { count: formatCount(leftOutCount) })}
        </p>
        <button
          className="button button-primary"
          type="button"
          disabled={committing || (plan.machines.length === 0 && plan.records.length === 0)}
          onClick={() => void handleCommit()}
        >
          <Check size={16} /> {committing ? t('import.committing') : t('import.commitButton')}
        </button>
      </div>
      {commitError && <p className="import-error" role="alert">{t('import.commitFailed')}</p>}
    </div>
  );
}

function UndatedEntryForm({
  row,
  onAddDate
}: {
  row: SkippedRow;
  onAddDate: (issueId: string, date: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!row.issueId || !date) return;

    setSaving(true);
    setSaveError(false);
    try {
      await onAddDate(row.issueId, date);
    } catch (error) {
      console.error('The workbook entry date could not be saved.', error);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li>
      <form className="import-undated-row" onSubmit={(event) => void handleSubmit(event)}>
        <div className="import-undated-copy">
          <strong>{row.description}</strong>
          <span>{[row.sheetName, row.details].filter(Boolean).join(' · ')}</span>
        </div>
        <input
          type="date"
          value={date}
          required
          aria-label={t('import.dateFor', { description: row.description })}
          onChange={(event) => setDate(event.target.value)}
        />
        <button className="button button-secondary" type="submit" disabled={saving || !date}>
          {t('import.addDate')}
        </button>
        {saveError && <p className="import-error" role="alert">{t('import.dateSaveFailed')}</p>}
      </form>
    </li>
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
  const newestFirst = [...maintenanceRecords].reverse();
  const service = nextService(
    machine,
    newestFirst.find((record) => record.meterReading !== undefined)?.meterReading
  );
  const details = [
    [t('profile.manufacturer'), machine.manufacturer],
    [t('profile.model'), machine.model],
    [t('profile.year'), machine.yearManufactured?.toString()],
    [t('profile.category'), machine.category],
    [t('profile.registration'), machine.registrationNumber],
    [t('profile.serial'), machine.serialNumber],
    [t('profile.location'), machine.location],
    [t('profile.fuel'), machine.fuelType],
    [t('profile.tankCapacity'), machine.tankCapacity],
    [
      t('profile.currentMeter'),
      machine.meterValue === undefined
        ? undefined
        : formatMeter(machine.meterValue, machine.meterUnit, i18n.resolvedLanguage, t)
    ]
  ].filter((detail): detail is [string, string] => Boolean(detail[1]));

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
          <p>{machineSubtitle(machine)}</p>
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
            {details.map(([label, value]) => (
              <Detail key={label} label={label} value={value} />
            ))}
          </div>
          {machine.parts && machine.parts.length > 0 && (
            <div className="parts-block">
              <h3>{t('profile.parts')}</h3>
              <dl className="parts-list">
                {machine.parts.map((part) => (
                  <div key={`${part.sourceCell ?? part.component}:${part.specification}`}>
                    <dt>{partLabel(part.component, t)}</dt>
                    <dd>{part.specification}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {machine.notes &&<div className="notes-block"><span>{t('profile.notes')}</span><p>{machine.notes}</p></div>}
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
              {newestFirst.map((record) => (
                <li key={record.id}>
                  <div className="maintenance-timeline-dot" />
                  <div className="maintenance-record-content">
                    <div className="maintenance-record-heading">
                      <strong>{record.workPerformed}</strong>
                      <time dateTime={record.performedAt}>
                        {formatRecordDate(record.performedAt, i18n.resolvedLanguage)}
                      </time>
                    </div>
                    {(record.category !== 'other' || record.meterReading !== undefined) && (
                      <div className="maintenance-record-tags">
                        {record.category !== 'other' && (
                          <span>{t(`maintenance.category.${record.category}`, { defaultValue: record.category })}</span>
                        )}
                        {record.meterReading !== undefined && (
                          <span>
                            <Gauge size={12} />
                            {formatMeter(record.meterReading, machine.meterUnit, i18n.resolvedLanguage, t)}
                          </span>
                        )}
                      </div>
                    )}
                    {record.partsUsed && <p>{t('maintenance.partsUsed')}: {record.partsUsed}</p>}
                    {record.notes && <p>{record.notes}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="panel profile-schedule">
          <div className="panel-heading">
            <div>
              <h2>{t('profile.schedule')}</h2>
              <p>{t('profile.upcoming')}</p>
            </div>
          </div>
          {service ? (
            <div className="schedule-target">
              <div className="schedule-target-icon">
                <Gauge size={19} />
              </div>
              <div>
                <strong>
                  {t('dashboard.serviceAt', {
                    value: formatMeter(service.target, service.unit, i18n.resolvedLanguage, t)
                  })}
                </strong>
                <ServiceRemaining service={service} />
              </div>
            </div>
          ) : (
            <div className="schedule-empty">
              <Clock3 size={19} />
              <div>
                <strong>{t('profile.noServiceTarget')}</strong>
                <span>{t('profile.noServiceTargetHint')}</span>
              </div>
            </div>
          )}
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
        parts: machine?.parts,
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
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

function formatMeter(
  value: number,
  unit: MeterUnit,
  locale: string | undefined,
  t: ReturnType<typeof useTranslation>['t']
): string {
  return `${new Intl.NumberFormat(locale).format(value)} ${meterUnitLabel(unit, t)}`.trim();
}

function formatRecordDate(performedAt: string, locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
    .format(new Date(`${performedAt}T00:00:00`));
}

const partLabelKeys: Record<string, string> = {
  oilfilterchange: 'parts.oilFilter',
  airfilterchange: 'parts.airFilter',
  fuelfilterchange: 'parts.fuelFilter',
  batteryreplacement: 'parts.battery',
  tires: 'parts.tires',
  tirerepairreplacement: 'parts.tires',
  hydraulic: 'parts.hydraulics',
  cranehydraulic: 'parts.hydraulics',
  compressorfilter: 'parts.compressorFilter',
  oilseperatorcartridge: 'parts.oilSeparator',
  oilseparatorcartridge: 'parts.oilSeparator',
  enginecoolant: 'parts.coolant'
};

function partLabel(component: string, t: ReturnType<typeof useTranslation>['t']): string {
  const key = partLabelKeys[component.toLocaleLowerCase().replace(/[^a-z0-9]/g, '')];
  return key ? t(key) : component;
}

function machineSubtitle(machine: Machine): string {
  return [machine.manufacturer, machine.model].filter(Boolean).join(' · ') || machine.category || '';
}

function greetingKey(): 'greeting.morning' | 'greeting.afternoon' | 'greeting.evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'greeting.morning';
  return hour < 18 ? 'greeting.afternoon' : 'greeting.evening';
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
