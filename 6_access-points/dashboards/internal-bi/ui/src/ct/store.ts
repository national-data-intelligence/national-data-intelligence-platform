/** Shared Control-Tower state, so the migrated CT widgets (filters, KPIs, movement
 *  network, dispatch) interact across separate widget mounts exactly as the
 *  standalone app did through App.tsx's useState — one store, many subscribers. */
import { useSyncExternalStore } from 'react';
import { ALL, type Slicer } from './lib/select';
import { SELECTED_ID } from './data/runtime';

export type CTView = 'routes' | 'network' | 'flow';
export interface CTState { slicer: Slicer; selectedId: string; view: CTView; focusNonce: number; dataNonce: number; }

let state: CTState = { slicer: ALL, selectedId: SELECTED_ID, view: 'routes', focusNonce: 0, dataNonce: 0 };
const subs = new Set<() => void>();

export const getCT = (): CTState => state;
export const setCT = (patch: Partial<CTState>): void => { state = { ...state, ...patch }; subs.forEach(f => f()); };
export const setSlice = (patch: Partial<Slicer>): void => setCT({ slicer: { ...state.slicer, ...patch } });
export const resetSlice = (): void => setCT({ slicer: ALL });
export const bumpFocus = (): void => setCT({ focusNonce: state.focusNonce + 1 });
export const bumpData = (): void => setCT({ dataNonce: state.dataNonce + 1 });

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useCT = (): CTState => useSyncExternalStore(subscribe, getCT, getCT);
