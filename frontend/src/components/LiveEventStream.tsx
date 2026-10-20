'use client';

import React, { useState, useMemo } from 'react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Search,
  Filter,
  Clock,
  Tag,
  Hash,
  Terminal,
} from 'lucide-react';
import type { KafkaStreamEvent } from '../types/analytics';

interface LiveEventStreamProps {
  events: KafkaStreamEvent[];
}

export const LiveEventStream: React.FC<LiveEventStreamProps> = ({ events }) => {
  const [filterType, setFilterType] = useState<'all' | 'published' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (filterType === 'published' && e.type !== 'kafka_published') return false;
      if (filterType === 'rejected' && e.type !== 'filter_rejected') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesChannel = e.channel.toLowerCase().includes(q);
        const matchesContent = e.content.toLowerCase().includes(q);
        return matchesChannel || matchesContent;
      }
      return true;
    });
  }, [events, filterType, searchQuery]);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg backdrop-blur-md">
      {/* Header and Controls */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <h2 className="text-sm font-bold text-white">
              Live Ingestion &amp; Filter SSE Feed
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Real-time ticker emitting every time a post is pushed to Kafka or fails keyword filter
          </p>
        </div>

        {/* Filter Pills & Search */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Filter channel or text..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 rounded-lg border border-slate-700/80 bg-slate-950/60 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
            />
          </div>

          {/* Type Filter Buttons */}
          <div className="flex rounded-lg border border-slate-700/80 bg-slate-950/60 p-0.5 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                filterType === 'all'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({events.length})
            </button>
            <button
              onClick={() => setFilterType('published')}
              className={`flex items-center space-x-1 rounded-md px-2.5 py-1 font-medium transition ${
                filterType === 'published'
                  ? 'bg-emerald-500/20 text-emerald-300 shadow-sm'
                  : 'text-slate-400 hover:text-emerald-400'
              }`}
            >
              <CheckCircle2 className="h-3 w-3" />
              <span>Kafka</span>
            </button>
            <button
              onClick={() => setFilterType('rejected')}
              className={`flex items-center space-x-1 rounded-md px-2.5 py-1 font-medium transition ${
                filterType === 'rejected'
                  ? 'bg-rose-500/20 text-rose-300 shadow-sm'
                  : 'text-slate-400 hover:text-rose-400'
              }`}
            >
              <XCircle className="h-3 w-3" />
              <span>Rejected</span>
            </button>
          </div>
        </div>
      </div>

      {/* Events List */}
      <div className="mt-4 flex-1 space-y-2.5 overflow-y-auto pr-1 max-h-[500px]">
        {filteredEvents.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center text-xs text-slate-500">
            <Terminal className="mb-2 h-6 w-6 text-slate-600" />
            <p>No telemetry events matching the current filter.</p>
            <p className="mt-1 text-[11px] text-slate-600">
              Click &quot;Simulate Ingest&quot; or enable &quot;Auto Stream&quot; to test.
            </p>
          </div>
        ) : (
          filteredEvents.map((event) => {
            const isPublished = event.type === 'kafka_published';
            const time = new Date(event.timestamp).toLocaleTimeString();

            return (
              <div
                key={event.id}
                className={`relative rounded-xl border p-3.5 transition-all duration-300 ${
                  isPublished
                    ? 'border-emerald-500/20 bg-emerald-950/10 hover:border-emerald-500/40 hover:bg-emerald-950/20'
                    : 'border-rose-500/20 bg-rose-950/10 hover:border-rose-500/40 hover:bg-rose-950/20'
                }`}
              >
                {/* Top Row: Channel, Source, Timestamp, and Decision Status */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                        isPublished
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-rose-500/20 text-rose-400'
                      }`}
                    >
                      {isPublished ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                    </span>

                    <span className="font-bold text-slate-100">{event.channel}</span>

                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        event.source === 'telegram'
                          ? 'bg-sky-500/15 text-sky-400'
                          : 'bg-neutral-800 text-neutral-300'
                      }`}
                    >
                      {event.source}
                    </span>

                    {isPublished && (event as any).reportId && (
                      <span className="hidden font-mono text-[10px] text-slate-500 sm:inline">
                        #{(event as any).reportId}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="flex items-center space-x-1 text-[11px] text-slate-400">
                      <Clock className="h-3 w-3" />
                      <span>{time}</span>
                    </span>

                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        isPublished
                          ? 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300'
                          : 'border border-rose-500/30 bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {isPublished ? 'Emitted to Kafka' : 'Keyword Filter Disqualified'}
                    </span>
                  </div>
                </div>

                {/* Post Content Snippet */}
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-300" dir="auto">
                  {event.content}
                </p>

                {/* Bottom Metadata Badges */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/40 text-[11px]">
                  {isPublished ? (
                    <>
                      <span className="text-slate-400 flex items-center space-x-1">
                        <Tag className="h-3 w-3 text-emerald-400" />
                        <span>Matched Lexicon:</span>
                      </span>
                      {((event as any).termsMatched || []).length > 0 ? (
                        ((event as any).termsMatched as string[]).map((term: string, i: number) => (
                          <span
                            key={i}
                            className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300"
                          >
                            {term}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-500 italic">threat criteria verified</span>
                      )}
                      {(event as any).language && (
                        <span className="ml-auto font-mono text-[10px] text-slate-400">
                          lang: <span className="text-slate-300">{(event as any).language}</span>
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-rose-400/90 font-medium">Rejection Reason:</span>
                      <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300">
                        {(event as any).reason || 'No violence or threat terms matched'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
