'use client';

import React from 'react';
import {
  Activity,
  Radio,
  RefreshCw,
  Play,
  Square,
  Zap,
  Server,
  Layers,
} from 'lucide-react';
import type { ConnectionStatus } from '../types/analytics';

interface NavbarProps {
  status: ConnectionStatus;
  lastHeartbeat: string | null;
  onSimulate: (count?: number) => void;
  onReset: () => void;
  isAutoSimulating: boolean;
  onToggleAutoSimulate: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  status,
  lastHeartbeat,
  onSimulate,
  onReset,
  isAutoSimulating,
  onToggleAutoSimulate,
}) => {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-[#090d16]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Brand & Title */}
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-2 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-400/40">
            <Radio className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold tracking-tight text-white sm:text-lg">
                Kafka Stream Telemetry & Keyword Analytics
              </h1>
              <span className="hidden rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-400 sm:inline-block">
                SSE Feed
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Live OSINT Threat Pipeline • Real-time Ingestion & Keyword Filter Gate
            </p>
          </div>
        </div>

        {/* Status & Control Actions */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Connection Status Pill */}
          <div className="flex items-center space-x-2 rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1 text-xs">
            {status === 'connected' ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span className="font-medium text-emerald-400">Live SSE Connected</span>
                {lastHeartbeat && (
                  <span className="hidden text-[11px] text-slate-500 md:inline">
                    ({lastHeartbeat})
                  </span>
                )}
              </>
            ) : status === 'connecting' ? (
              <>
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                <span className="text-amber-400">Connecting...</span>
              </>
            ) : (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
                <span className="text-rose-400">Offline (Simulating)</span>
              </>
            )}
          </div>

          {/* Auto Simulation Toggle */}
          <button
            onClick={onToggleAutoSimulate}
            className={`flex items-center space-x-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              isAutoSimulating
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-sm shadow-emerald-500/20'
                : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Auto-feed stream with simulated live posts every 2.5s"
          >
            {isAutoSimulating ? (
              <>
                <Square className="h-3 w-3 fill-emerald-400 text-emerald-400" />
                <span className="hidden sm:inline">Pause Stream</span>
              </>
            ) : (
              <>
                <Play className="h-3 w-3 fill-slate-300 text-slate-300" />
                <span className="hidden sm:inline">Auto Stream</span>
              </>
            )}
          </button>

          {/* Manual Ingestion Simulator */}
          <button
            onClick={() => onSimulate(1)}
            className="flex items-center space-x-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 text-xs font-medium text-teal-300 transition-all hover:bg-teal-500/20 hover:text-teal-200"
            title="Simulate 1 incoming post ingestion"
          >
            <Zap className="h-3 w-3" />
            <span>Simulate Ingest</span>
          </button>

          {/* Reset Button */}
          <button
            onClick={onReset}
            className="rounded-lg border border-slate-800 bg-slate-900/60 p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            title="Reset telemetry baseline"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
