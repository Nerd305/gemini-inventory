import React, { useEffect, useState } from 'react';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Activity,
  AlertTriangle,
  Eye,
  Loader2,
  Plus,
  Refrigerator,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  CapColorMap,
  FridgeConfig,
  ApiBridgeConfig,
  loadAppSettings,
  makeFridgeConfig,
  saveAppSettings,
} from '../lib/config';
import { APP_VERSION } from '../lib/version';
import { AiStats, loadAiStats } from '../lib/learning';
import { HelpTooltip } from '../components/HelpTooltip';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function Settings() {
  const { user, role } = useAuth();
  const isAdmin = role === 'admin';

  const [step, setStep] = useState(0); // 0: none, 1: first confirm, 2: second confirm
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const [fridges, setFridges] = useState<FridgeConfig[]>([]);
  const [originalFridges, setOriginalFridges] = useState<FridgeConfig[]>([]);
  const [loadingFridges, setLoadingFridges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [hudEnabled, setHudEnabled] = useState(false);
  const [capColorMap, setCapColorMap] = useState<CapColorMap>({});
  const [originalHud, setOriginalHud] = useState<{ hudEnabled: boolean; capColorMap: CapColorMap }>({
    hudEnabled: false,
    capColorMap: {},
  });
  const [hudSaveStatus, setHudSaveStatus] = useState<SaveStatus>('idle');
  const [hudSaveError, setHudSaveError] = useState<string | null>(null);

  const [apiBridgeConfig, setApiBridgeConfig] = useState<ApiBridgeConfig>({ webhookUrl: '', apiKey: '', enabled: false });
  const [originalApiBridgeConfig, setOriginalApiBridgeConfig] = useState<ApiBridgeConfig>({ webhookUrl: '', apiKey: '', enabled: false });
  const [apiSaveStatus, setApiSaveStatus] = useState<SaveStatus>('idle');
  const [apiSaveError, setApiSaveError] = useState<string | null>(null);

  const [aiStats, setAiStats] = useState<AiStats | null>(null);
  const [aiStatsLoading, setAiStatsLoading] = useState(false);
  const [aiStatsError, setAiStatsError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoadingFridges(true);
    loadAppSettings()
      .then((settings) => {
        if (cancelled) return;
        setFridges(settings.fridges);
        setOriginalFridges(settings.fridges);
        setHudEnabled(settings.hudEnabled);
        setCapColorMap(settings.capColorMap);
        setOriginalHud({ hudEnabled: settings.hudEnabled, capColorMap: settings.capColorMap });
        setApiBridgeConfig(settings.apiBridgeConfig);
        setOriginalApiBridgeConfig(settings.apiBridgeConfig);
      })
      .catch((error) => {
        handleFirestoreError(error, OperationType.GET, 'config/appSettings');
      })
      .finally(() => {
        if (!cancelled) setLoadingFridges(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setAiStatsLoading(true);
    setAiStatsError(null);
    loadAiStats()
      .then((stats) => {
        if (!cancelled) setAiStats(stats);
      })
      .catch((error) => {
        if (cancelled) return;
        setAiStatsError(error instanceof Error ? error.message : 'Failed to load AI stats');
        handleFirestoreError(error, OperationType.GET, 'learningData');
      })
      .finally(() => {
        if (!cancelled) setAiStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const isDirty = JSON.stringify(fridges) !== JSON.stringify(originalFridges);

  const handleAddFridge = () => {
    setFridges((prev) => [
      ...prev,
      makeFridgeConfig({ name: `Fridge ${prev.length + 1}` }),
    ]);
    setSaveStatus('idle');
  };

  const handleRemoveFridge = (id: string) => {
    setFridges((prev) => prev.filter((f) => f.id !== id));
    setSaveStatus('idle');
  };

  const handleUpdateFridge = (id: string, patch: Partial<FridgeConfig>) => {
    setFridges((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
    setSaveStatus('idle');
  };

  const handleSaveFridges = async () => {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await saveAppSettings({ fridges }, user?.uid);
      setOriginalFridges(fridges);
      setSaveStatus('saved');
    } catch (error: any) {
      setSaveStatus('error');
      setSaveError(error?.message ?? 'Unknown error');
      handleFirestoreError(error, OperationType.WRITE, 'config/appSettings');
    }
  };

  const isHudDirty =
    hudEnabled !== originalHud.hudEnabled ||
    JSON.stringify(capColorMap) !== JSON.stringify(originalHud.capColorMap);

  const capColorEntries = Object.entries(capColorMap) as [string, string][];

  const handleAddCapMapping = () => {
    let i = 1;
    let key = `#000000`;
    while (key in capColorMap) {
      i += 1;
      key = `#000000-${i}`;
    }
    setCapColorMap((prev) => ({ ...prev, [key]: '' }));
    setHudSaveStatus('idle');
  };

  const handleUpdateCapMapping = (oldKey: string, newKey: string, value: string) => {
    setCapColorMap((prev) => {
      const next: CapColorMap = {};
      for (const [k, v] of Object.entries(prev) as [string, string][]) {
        if (k === oldKey) {
          next[newKey] = value;
        } else {
          next[k] = v;
        }
      }
      return next;
    });
    setHudSaveStatus('idle');
  };

  const handleRemoveCapMapping = (key: string) => {
    setCapColorMap((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setHudSaveStatus('idle');
  };

  const handleSaveHud = async () => {
    setHudSaveStatus('saving');
    setHudSaveError(null);
    try {
      const cleaned: CapColorMap = {};
      for (const [k, v] of Object.entries(capColorMap) as [string, string][]) {
        if (k.trim() && v.trim()) cleaned[k.trim().toLowerCase()] = v.trim();
      }
      await saveAppSettings({ hudEnabled, capColorMap: cleaned }, user?.uid);
      setCapColorMap(cleaned);
      setOriginalHud({ hudEnabled, capColorMap: cleaned });
      setHudSaveStatus('saved');
    } catch (error: any) {
      setHudSaveStatus('error');
      setHudSaveError(error?.message ?? 'Unknown error');
      handleFirestoreError(error, OperationType.WRITE, 'config/appSettings');
    }
  };

  const isApiDirty = JSON.stringify(apiBridgeConfig) !== JSON.stringify(originalApiBridgeConfig);

  const handleSaveApiBridge = async () => {
    setApiSaveStatus('saving');
    setApiSaveError(null);
    try {
      await saveAppSettings({ apiBridgeConfig }, user?.uid);
      setOriginalApiBridgeConfig(apiBridgeConfig);
      setApiSaveStatus('saved');
    } catch (error: any) {
      setApiSaveStatus('error');
      setApiSaveError(error?.message ?? 'Unknown error');
      handleFirestoreError(error, OperationType.WRITE, 'config/appSettings');
    }
  };

  const handleFactoryReset = async () => {
    if (confirmText !== 'RESET') return;
    setIsDeleting(true);
    try {
      const collections = ['products', 'locations', 'baskets', 'inventoryLogs', 'printJobs'];

      for (const col of collections) {
        const snapshot = await getDocs(collection(db, col));
        const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, col, d.id)));
        await Promise.all(deletePromises);
      }

      alert('Factory reset complete. All data has been purged.');
      setStep(0);
      setConfirmText('');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.DELETE, 'multiple');
      alert(`Error during reset: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Refrigerator className="h-5 w-5 mr-2 text-blue-600" />
              Fridge Configuration
              <HelpTooltip content="Define the physical layout of your storage. This structure directly dictates how the Guided Counting sessions step through shelves and baskets." />
            </CardTitle>
            <CardDescription>
              Define the fridges available in this facility and their layout. These settings power the
              counting flow's shelf and basket-slot navigation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingFridges ? (
              <div className="flex items-center text-sm text-gray-500">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading fridges...
              </div>
            ) : fridges.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                No fridges configured yet. Click "Add Fridge" to create the first one.
              </div>
            ) : (
              <div className="space-y-3">
                {fridges.map((fridge) => (
                  <div
                    key={fridge.id}
                    className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-3">
                          <Label htmlFor={`fridge-name-${fridge.id}`} className="text-xs text-gray-500">
                            Name
                          </Label>
                          <Input
                            id={`fridge-name-${fridge.id}`}
                            value={fridge.name}
                            onChange={(e) =>
                              handleUpdateFridge(fridge.id, { name: e.target.value })
                            }
                            placeholder="e.g. Main Refrigerator"
                          />
                        </div>
                        <div>
                          <Label
                            htmlFor={`fridge-shelves-${fridge.id}`}
                            className="text-xs text-gray-500"
                          >
                            Shelves
                          </Label>
                          <Input
                            id={`fridge-shelves-${fridge.id}`}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            value={fridge.shelfCount}
                            onChange={(e) =>
                              handleUpdateFridge(fridge.id, {
                                shelfCount: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label
                            htmlFor={`fridge-slots-${fridge.id}`}
                            className="text-xs text-gray-500"
                          >
                            Basket slots / shelf
                          </Label>
                          <Input
                            id={`fridge-slots-${fridge.id}`}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            value={fridge.basketSlotsPerShelf}
                            onChange={(e) =>
                              handleUpdateFridge(fridge.id, {
                                basketSlotsPerShelf: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                          />
                        </div>
                        <div className="sm:col-span-1">
                          <Label className="text-xs text-gray-500">ID</Label>
                          <div className="text-xs font-mono text-gray-400 truncate pt-2">
                            {fridge.id}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveFridge(fridge.id)}
                        title="Remove fridge"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
              <Button variant="outline" onClick={handleAddFridge}>
                <Plus className="h-4 w-4 mr-2" />
                Add Fridge
              </Button>
              <div className="flex items-center gap-3">
                {saveStatus === 'saved' && !isDirty && (
                  <span className="text-sm text-green-600">Saved</span>
                )}
                {saveStatus === 'error' && (
                  <span className="text-sm text-red-600">{saveError ?? 'Save failed'}</span>
                )}
                <Button
                  onClick={handleSaveFridges}
                  disabled={!isDirty || saveStatus === 'saving'}
                >
                  {saveStatus === 'saving' ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {saveStatus === 'saving' ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Eye className="h-5 w-5 mr-2 text-blue-600" />
              Camera HUD
              <HelpTooltip content="The visual overlay for the AI vision system. When enabled, the camera displays real-time bounding boxes around detected vials." />
            </CardTitle>
            <CardDescription>
              Show a targeting overlay with AI-detected vials over the live camera in counting sessions.
              Map cap colors to product names so the HUD can label each vial.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <label className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
              <div>
                <div className="font-medium text-gray-900">Enable Camera HUD globally</div>
                <p className="text-xs text-gray-500">
                  When on, the counting session renders crosshairs and AI bounding boxes over the camera.
                </p>
              </div>
              <input
                type="checkbox"
                className="h-5 w-5 accent-blue-600"
                checked={hudEnabled}
                onChange={(e) => {
                  setHudEnabled(e.target.checked);
                  setHudSaveStatus('idle');
                }}
              />
            </label>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-900">Cap color map</div>
                  <p className="text-xs text-gray-500">
                    Map a cap color (hex like <code>#ff0000</code> or a name like <code>red</code>) to the
                    product name shown next to detected vials.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleAddCapMapping}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>

              {capColorEntries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">
                  No mappings yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {capColorEntries.map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                      <Input
                        value={key}
                        onChange={(e) => handleUpdateCapMapping(key, e.target.value, value)}
                        placeholder="#ff0000"
                        className="w-40 font-mono text-sm"
                      />
                      <Input
                        value={value}
                        onChange={(e) => handleUpdateCapMapping(key, key, e.target.value)}
                        placeholder="Product name"
                        className="flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleRemoveCapMapping(key)}
                        title="Remove mapping"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              {hudSaveStatus === 'saved' && !isHudDirty && (
                <span className="text-sm text-green-600">Saved</span>
              )}
              {hudSaveStatus === 'error' && (
                <span className="text-sm text-red-600">{hudSaveError ?? 'Save failed'}</span>
              )}
              <Button onClick={handleSaveHud} disabled={!isHudDirty || hudSaveStatus === 'saving'}>
                {hudSaveStatus === 'saving' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {hudSaveStatus === 'saving' ? 'Saving...' : 'Save HUD Settings'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Sparkles className="h-5 w-5 mr-2 text-purple-600" />
              AI Performance Stats
            </CardTitle>
            <CardDescription>
              Live data from accepted AI tray counts. Each time staff taps "AI Count This Tray" and accepts the
              result, a sample is saved here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {aiStatsLoading && (
              <div className="flex items-center justify-center py-12 text-gray-500">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Loading AI stats…
              </div>
            )}

            {!aiStatsLoading && aiStatsError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Could not load AI stats: {aiStatsError}
              </div>
            )}

            {!aiStatsLoading && !aiStatsError && aiStats && aiStats.totalSamples === 0 && (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-600">
                <p className="font-medium text-gray-800 mb-1">No AI counts recorded yet</p>
                <p>
                  Use <span className="font-semibold">AI Count This Tray</span> on the counting screen and accept
                  the result. Samples will appear here.
                </p>
                <p className="mt-3 text-xs text-gray-500">
                  Model: <span className="font-semibold">{aiStats.model}</span> · App v{APP_VERSION}
                </p>
              </div>
            )}

            {!aiStatsLoading && !aiStatsError && aiStats && aiStats.totalSamples > 0 && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 text-center">
                    <p className="text-sm text-gray-500 mb-1">AI Tray Counts</p>
                    <p className="text-2xl font-bold text-gray-900">{aiStats.totalSamples.toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 text-center">
                    <p className="text-sm text-gray-500 mb-1">Vials Counted by AI</p>
                    <p className="text-2xl font-bold text-gray-900">{aiStats.vialsCounted.toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 text-center">
                    <p className="text-sm text-gray-500 mb-1">Accuracy (within ±1)</p>
                    <p className="text-2xl font-bold text-green-600">
                      {aiStats.accuracyPct === null ? '—' : `${aiStats.accuracyPct}%`}
                    </p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 text-center">
                    <p className="text-sm text-gray-500 mb-1">Model</p>
                    <p className="text-sm font-semibold text-gray-900">{aiStats.model}</p>
                    <p className="text-xs text-blue-600 mt-1">App v{APP_VERSION}</p>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 bg-white h-48 flex items-end justify-between relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-t from-purple-50/50 to-transparent pointer-events-none" />
                  {aiStats.weeklyTrend.map((trend, i) => {
                    const heightPct = trend.accuracy === null ? 0 : Math.max(2, trend.accuracy);
                    return (
                      <div key={i} className="flex flex-col items-center flex-1 z-10">
                        <div className="w-full px-2 flex items-end justify-center h-32">
                          <div
                            className="w-full max-w-[40px] bg-purple-500 rounded-t-md opacity-80 hover:opacity-100 transition-opacity"
                            style={{ height: `${heightPct}%` }}
                            title={
                              trend.accuracy === null
                                ? 'No samples'
                                : `${trend.accuracy}% (${trend.sampleCount} samples)`
                            }
                          />
                        </div>
                        <span className="text-xs text-gray-500 mt-2 font-medium">{trend.week}</span>
                        <span className="text-xs text-gray-900 font-bold">
                          {trend.accuracy === null ? '—' : `${trend.accuracy}%`}
                        </span>
                        <span className="text-[10px] text-gray-400">n={trend.sampleCount}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  Accuracy = share of AI counts within ±1 vial of the human-accepted count, over the last 28 days.
                  Today these samples are <span className="font-semibold">collected but not fed back into the
                  model</span> — see roadmap for the learning loop.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Activity className="h-5 w-5 mr-2 text-blue-600" />
              API Bridge Configuration
              <HelpTooltip content="Connect this inventory system to your external Point of Sale or Pharmacy Management System so stock decrements automatically when sales occur." />
            </CardTitle>
            <CardDescription>
              Connect to external ordering systems via webhooks to synchronize inventory.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
              <div>
                <div className="font-medium text-gray-900">Enable External API Bridge</div>
                <p className="text-xs text-gray-500">
                  Allow inbound SALE events to decrement stock.
                </p>
              </div>
              <input
                type="checkbox"
                className="h-5 w-5 accent-blue-600"
                checked={apiBridgeConfig.enabled}
                onChange={(e) => {
                  setApiBridgeConfig(prev => ({ ...prev, enabled: e.target.checked }));
                  setApiSaveStatus('idle');
                }}
              />
            </label>

            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Webhook URL</Label>
              <Input
                id="webhookUrl"
                placeholder="https://api.example.com/webhook"
                value={apiBridgeConfig.webhookUrl}
                onChange={(e) => {
                  setApiBridgeConfig(prev => ({ ...prev, webhookUrl: e.target.value }));
                  setApiSaveStatus('idle');
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key / Secret</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="secret-token-123"
                value={apiBridgeConfig.apiKey}
                onChange={(e) => {
                  setApiBridgeConfig(prev => ({ ...prev, apiKey: e.target.value }));
                  setApiSaveStatus('idle');
                }}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              {apiSaveStatus === 'saved' && !isApiDirty && (
                <span className="text-sm text-green-600">Saved</span>
              )}
              {apiSaveStatus === 'error' && (
                <span className="text-sm text-red-600">{apiSaveError ?? 'Save failed'}</span>
              )}
              <Button onClick={handleSaveApiBridge} disabled={!isApiDirty || apiSaveStatus === 'saving'}>
                {apiSaveStatus === 'saving' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {apiSaveStatus === 'saving' ? 'Saving...' : 'Save API Settings'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card className="border-blue-100 bg-blue-50/30">
          <CardHeader>
            <CardTitle className="text-blue-800 text-lg">API Documentation (White Paper)</CardTitle>
            <CardDescription className="text-blue-700/80">
              Technical details for integrating the API Bridge.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-700">
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">1. Outbound Webhooks (Push)</h3>
              <p className="mb-2">When inventory changes in VialTrack, a POST request is sent to your configured <strong>Webhook URL</strong>. You must respond with a 2xx status code.</p>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded-md overflow-x-auto">
{`POST /your-webhook-endpoint
Headers:
  Content-Type: application/json
  Authorization: Bearer <Your API Key>

Body:
{
  "productId": "string",
  "newStock": number,
  "source": "vialtrack",
  "timestamp": "ISO 8601 Date"
}`}
              </pre>
            </div>
            
            <div className="pt-4 border-t border-blue-100">
              <h3 className="font-semibold text-gray-900 mb-1">2. Inbound Webhooks (Pull)</h3>
              <p className="mb-2">Your external POS or Pharmacy Management System can decrement stock by sending a POST request to our API Server.</p>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded-md overflow-x-auto">
{`POST /api/webhook/sale
Headers:
  Content-Type: application/json
  Authorization: Bearer <Your API Key>

Body:
{
  "productId": "string",
  "quantityRemoved": number,
  "orderId": "string (optional)"
}`}
              </pre>
            </div>
            
            <div className="pt-4 border-t border-blue-100">
              <h3 className="font-semibold text-gray-900 mb-1">cURL Example (Inbound)</h3>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded-md overflow-x-auto">
{`curl -X POST http://your-server-url/api/webhook/sale \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${API_KEY}" \\
  -d '{
    "productId": "some-product-id",
    "quantityRemoved": 1,
    "orderId": "RX-12345"
  }'`}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-red-200 bg-red-50/30">
        <CardHeader>
          <CardTitle className="text-red-700 flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            Danger Zone
          </CardTitle>
          <CardDescription className="text-red-600/80">
            Irreversible actions that affect the entire application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-white rounded-lg border border-red-100 shadow-sm">
            <div className="mb-4 sm:mb-0">
              <h3 className="font-semibold text-gray-900">Factory Reset</h3>
              <p className="text-sm text-gray-500">Permanently delete all products, locations, inventory logs, and print jobs.</p>
            </div>
            <Button variant="destructive" onClick={() => setStep(1)}>
              Factory Reset App
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* First Confirmation Dialog */}
      <Dialog open={step === 1} onOpenChange={(open) => !open && setStep(0)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Are you absolutely sure?
            </DialogTitle>
            <DialogDescription className="pt-4 text-base text-gray-700">
              This action will <strong>permanently delete</strong> all data in the application, including:
              <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
                <li>All Products</li>
                <li>All Locations</li>
                <li>All Baskets and Inventory Counts</li>
                <li>All History and Logs</li>
                <li>All Print Jobs</li>
              </ul>
              <br />
              This action cannot be undone. Do you wish to proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setStep(0)}>Cancel</Button>
            <Button variant="destructive" onClick={() => setStep(2)}>Yes, I understand</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Second Confirmation Dialog */}
      <Dialog open={step === 2} onOpenChange={(open) => !open && setStep(0)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Final Confirmation</DialogTitle>
            <DialogDescription className="pt-2">
              To confirm the factory reset, please type <strong>RESET</strong> in the box below.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="confirm" className="sr-only">Confirm Reset</Label>
            <Input
              id="confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type RESET here"
              className="border-red-300 focus-visible:ring-red-500"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setStep(0); setConfirmText(''); }} disabled={isDeleting}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleFactoryReset}
              disabled={confirmText !== 'RESET' || isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isDeleting ? 'Purging Data...' : 'Purge All Data'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
